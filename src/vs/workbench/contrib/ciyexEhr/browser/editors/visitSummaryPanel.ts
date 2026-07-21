/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { editorBackground, editorForeground, editorWidgetBackground, editorWidgetBorder } from '../../../../../platform/theme/common/colors/editorColors.js';
import { descriptionForeground, errorForeground, textLinkForeground } from '../../../../../platform/theme/common/colors/baseColors.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';
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
	// Enriched client-side (enrichSummaryMeta) — QA asked the Encounter Summary
	// header to also carry the provider, encounter id and patient demographics.
	providerName?: string;
	encounterId?: string;
	dateOfBirth?: string;
	ageGender?: string;
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
	readonly nativeHostService: INativeHostService;
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

/** Full display names for the FHIR v3-ActCode encounter class codes the backend
 *  stores in `meta.type` / `Encounter.type` — QA flagged the raw "AMB" as not
 *  being the full form. Unknown values pass through unchanged. */
const ENCOUNTER_TYPE_FULL_FORMS: Record<string, string> = {
	AMB: 'Ambulatory',
	IMP: 'Inpatient',
	ACUTE: 'Inpatient Acute',
	NONAC: 'Inpatient Non-Acute',
	EMER: 'Emergency',
	VR: 'Virtual',
	HH: 'Home Health',
	FLD: 'Field',
	OBSENC: 'Observation Encounter',
	PRENC: 'Pre-Admission',
	SS: 'Short Stay',
};

/** Expand a short encounter class code ("AMB") to its full form ("Ambulatory"). */
export function expandEncounterType(raw: string | undefined): string | undefined {
	if (!raw) { return raw; }
	const key = raw.trim().toUpperCase();
	return ENCOUNTER_TYPE_FULL_FORMS[key] || raw;
}

/** Builds the Visit Summary slide-over (panel + backdrop) and loads its data.
 *  Read-only — it deliberately does NOT redirect to the encounter editor or
 *  patient chart. Shared by the appointments editor and the encounter sidebar.
 *  `facilityHint` is the visit's location name when the caller already knows it
 *  (e.g. the appointment row's location — the provider's location for the
 *  visit); it backfills the Facility field because the Encounter resource
 *  itself carries no location. */
export function showVisitSummaryPanel(deps: IVisitSummaryDeps, patientId: string, encounterId: string, patientName: string, facilityHint?: string): void {
	const doc = DOM.getActiveWindow().document;
	const col = summaryColors(deps.themeService);

	// Backdrop dimmer — click outside to dismiss.
	const backdrop = DOM.append(doc.body, DOM.$('div.ciyex-summary-backdrop'));
	backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:9998;display:flex;justify-content:flex-end;';

	// Print-only page frame — a thin border rectangle drawn on EVERY printed page.
	// A position:fixed element repeats on each page in Chromium's print path, so it
	// gives the document the boxed look of the reference letterhead. It's inset
	// inside the printToPDF margins so the content sits within the frame and the
	// page-number footer prints just below it. All of its styling (position/border)
	// lives in the print stylesheet; on screen it stays display:none.
	DOM.append(backdrop, DOM.$('div.ciyex-summary-pageframe'));

	// Right-anchored slide-over sheet.
	const sheet = DOM.append(backdrop, DOM.$('div.ciyex-summary-sheet'));
	sheet.style.cssText = `background:${col.bg};color:${col.fg};width:min(720px,65vw);height:100%;box-shadow:-8px 0 32px rgba(0,0,0,0.35);display:flex;flex-direction:column;overflow:hidden;font-family:var(--vscode-font-family);`;

	// Header with title + Close. Download / Print live in a bottom footer.
	// The slide-over reaches the very top of the window, so its header overlaps the
	// native window controls (minimise / maximise / close) on the desktop exe — the
	// header's own Close (×) ended up hidden underneath them. Pad the header down by
	// the titlebar band so the title + × sit BELOW the OS controls and stay visible /
	// clickable. `env(titlebar-area-height)` resolves to the real control height when
	// Window Controls Overlay is on and falls back to the custom-titlebar height
	// (35px) otherwise — correct in both desktop configurations.
	const header = DOM.append(sheet, DOM.$('div.ciyex-summary-header'));
	header.style.cssText = `display:flex;align-items:center;gap:8px;padding:calc(12px + env(titlebar-area-height, 35px)) 16px 12px;border-bottom:1px solid ${col.border};background:${col.widgetBg};flex-shrink:0;`;
	const headerTitle = DOM.append(header, DOM.$('span'));
	// allow-any-unicode-next-line
	headerTitle.textContent = `Visit Summary — ${patientName}`;
	headerTitle.style.cssText = `font-size:14px;font-weight:600;color:${col.fg};flex:1;`;
	const closeBtn = DOM.append(header, DOM.$('button.codicon.codicon-close')) as HTMLButtonElement;
	closeBtn.title = 'Close';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:transparent;color:${col.desc};border:none;border-radius:5px;cursor:pointer;font-size:15px;margin-right:8px;`;
	closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(128,128,128,0.18))'; closeBtn.style.color = col.fg; });
	closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = col.desc; });

	// Scrollable body where the summary content is rendered.
	const body = DOM.append(sheet, DOM.$('div.ciyex-summary-body'));
	// Keep the body scrollable (content can be long) but hide the visible
	// scrollbar — matches the rest of the app's chrome-less look.
	body.style.cssText = `overflow-y:auto;overflow-x:hidden;padding:20px 22px;flex:1;background:${col.bg};scrollbar-width:none;-ms-overflow-style:none;`;

	// Print/PDF structure: the content lives in a <table> whose <thead> carries the
	// practice/patient letterhead. Chromium (both window.print() and the main
	// process printToPDF) REPEATS a table-header-group on every page and reserves
	// its height, so the letterhead prints atop each page with no overlap — the one
	// reliable cross-page repeating-header technique. On screen the thead is hidden
	// and the table/cells collapse to blocks (see the screen stylesheet below) so
	// the panel looks exactly as before.
	const printTable = DOM.append(body, DOM.$('table.ciyex-summary-table'));
	printTable.style.cssText = 'width:100%;border-collapse:collapse;';
	const runHead = DOM.append(printTable, DOM.$('thead.ciyex-summary-runhead'));
	const headCell = DOM.append(DOM.append(runHead, DOM.$('tr')), DOM.$('td')) as HTMLElement;
	const content = DOM.append(DOM.append(DOM.append(printTable, DOM.$('tbody')), DOM.$('tr')), DOM.$('td.ciyex-summary-content')) as HTMLElement;
	content.style.cssText = 'padding:0;vertical-align:top;';
	const loading = DOM.append(content, DOM.$('div'));
	loading.textContent = 'Loading encounter summary…';
	loading.style.cssText = `font-size:13px;color:${col.desc};`;

	// Footer action toolbar — clearly-labelled Download / Print buttons.
	const footer = DOM.append(sheet, DOM.$('div.ciyex-summary-footer'));
	footer.style.cssText = `display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;border-top:1px solid ${col.border};background:${col.widgetBg};flex-shrink:0;`;
	const makeFooterBtn = (codicon: string, label: string, primary: boolean): { btn: HTMLButtonElement; lbl: HTMLElement } => {
		const btn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		btn.style.cssText = primary
			? 'display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;'
			: `display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid ${col.border};border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;`;
		const ic = DOM.append(btn, DOM.$('span.codicon.codicon-' + codicon));
		ic.style.cssText = 'font-size:14px;';
		const lbl = DOM.append(btn, DOM.$('span'));
		lbl.textContent = label;
		return { btn, lbl };
	};
	const { btn: pdfBtn } = makeFooterBtn('cloud-download', 'Download PDF', true);
	const { btn: printBtn } = makeFooterBtn('printer', 'Print', false);

	// A print-only stylesheet (it lives entirely inside `@media print`, so it has
	// NO on-screen effect) that isolates the summary body for both actions —
	// "Download PDF" (the native host renders the window to a PDF) and "Print"
	// (the OS print dialog). It hides the workbench, the panel header/footer and
	// the backdrop dimmer so only the summary content — forced to legible
	// black-on-white — lands on the page / in the saved file, regardless of the
	// active light/dark theme.
	//
	// The letterhead lives in the content table's <thead> (.ciyex-summary-runhead).
	// On screen that thead is hidden and the table/cells collapse to blocks so the
	// panel is visually unchanged; in print the table displays as a real table so
	// the thead becomes a repeating table-header-group on every page.
	const printStyle = doc.createElement('style');
	printStyle.textContent = [
		// Screen: hide the run-head + the print-only page frame, flatten the print
		// table to plain blocks.
		'.ciyex-summary-runhead{display:none;}',
		'.ciyex-summary-pageframe{display:none;}',
		'.ciyex-summary-table,.ciyex-summary-table>tbody,.ciyex-summary-table>tbody>tr,.ciyex-summary-content{display:block;width:100%;}',
		'@media print{',
		'  body>*:not(.ciyex-summary-backdrop){display:none !important;}',
		'  .ciyex-summary-backdrop{position:static !important;background:#fff !important;display:block !important;inset:auto !important;}',
		// The page frame: a border box repeated on every printed page. In print a
		// position:fixed element is laid out against the page CONTENT box (inside the
		// margins) and painted on each page, so `inset:0` traces the content box edge
		// — i.e. the border sits just inside the paper margin. The content cells get
		// their own padding below so text never touches this border.
		'  .ciyex-summary-pageframe{display:block !important;position:fixed !important;inset:0 !important;border:1px solid #9aa0a6 !important;border-radius:2px;pointer-events:none;z-index:0;background:transparent !important;}',
		'  .ciyex-summary-sheet{box-shadow:none !important;border-radius:0 !important;width:100% !important;height:auto !important;max-height:none !important;background:#fff !important;color:#222 !important;overflow:visible !important;}',
		'  .ciyex-summary-header, .ciyex-summary-footer{display:none !important;}',
		'  .ciyex-summary-body{overflow:visible !important;height:auto !important;background:#fff !important;}',
		'  .ciyex-summary-body, .ciyex-summary-body *{background-color:transparent !important;color:#222 !important;border-color:#d8d8d8 !important;box-shadow:none !important;}',
		// Print: restore real table semantics so the letterhead repeats per page.
		'  .ciyex-summary-table{display:table !important;width:100% !important;border-collapse:collapse !important;}',
		'  .ciyex-summary-runhead{display:table-header-group !important;}',
		'  .ciyex-summary-table>tbody{display:table-row-group !important;}',
		'  .ciyex-summary-table>tbody>tr,.ciyex-summary-runhead>tr{display:table-row !important;}',
		'  .ciyex-summary-content,.ciyex-summary-runhead td{display:table-cell !important;}',
		// Inset the printed content from the page-frame border so nothing (letterhead
		// or section boxes) touches the box drawn at the content-box edge. The
		// letterhead cell repeats every page, so its top/side padding keeps the
		// letterhead clear of the frame on every page.
		'  .ciyex-summary-runhead td{padding:5mm 6mm 10px !important;}',
		'  .ciyex-summary-content{padding:2mm 6mm 6mm !important;}',
		// The letterhead rules are deliberately bold black — override the generic
		// light-grey border rule above (higher specificity beats it).
		'  .ciyex-summary-runhead .vs-hdr-rule{border-bottom:2px solid #222 !important;}',
		// Keep each section box intact — a section (e.g. Vitals) must not split with
		// half its rows on one page and half on the next. break-inside:avoid moves
		// the whole card to the next page when it would otherwise straddle the break
		// (a card taller than a full page still breaks — unavoidable). This is the
		// QA ask: sections should print together on a single page.
		'  .vs-card{break-inside:avoid !important;page-break-inside:avoid !important;}',
		// The signature line stays a firm dark rule (beats the generic light-grey
		// border override above).
		'  .vs-sig-rule{border-color:#222 !important;}',
		// Page margins: the printToPDF path sets matching margins (and the page-number
		// footer) — this @page rule governs the browser Print dialog path so the frame
		// and content sit the same distance from the paper edge there too.
		'  @page{margin:12mm;}',
		'}',
	].join('');
	doc.head.appendChild(printStyle);

	const dismiss = () => {
		try { doc.body.removeChild(backdrop); } catch { /* ignore */ }
		try { doc.head.removeChild(printStyle); } catch { /* ignore */ }
	};
	closeBtn.addEventListener('click', dismiss);
	backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { dismiss(); } });

	// Tracks whether the summary finished loading, so the print / PDF actions can
	// refuse to operate on a still-loading panel.
	let summaryLoaded = false;

	// "Download PDF" saves the summary STRAIGHT to a real `.pdf` file in the
	// Downloads folder — no preview, no OS print dialog. The main process renders
	// the active window to a PDF (honouring the print stylesheet above, so only
	// the summary — black-on-white — is captured) and writes it to disk, because a
	// renderer-side `blob:` download anchor does not produce a file in the
	// `vscode-file://` workbench.
	const downloadPdf = async () => {
		if (!summaryLoaded) {
			deps.notificationService.notify({ severity: Severity.Info, message: 'The visit summary is still loading. Please try again in a moment.' });
			return;
		}
		pdfBtn.disabled = true;
		try {
			const savedPath = await deps.nativeHostService.savePdfToDownloads(`encounter-${encounterId}-summary.pdf`);
			if (!savedPath) {
				// The user cancelled the Save dialog — keep the panel open, no error.
				return;
			}
			deps.notificationService.notify({ severity: Severity.Info, message: `Visit summary saved to ${savedPath}` });
			// The PDF is already captured (printToPDF resolved above), so it is safe to
			// close the panel now — the download is done and the user expects the
			// summary to dismiss once the file has been saved.
			dismiss();
		} catch (err) {
			deps.notificationService.notify({ severity: Severity.Error, message: `Could not save the visit summary PDF: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			pdfBtn.disabled = false;
		}
	};

	// "Print" renders the summary to a PDF in the main process and opens it in the
	// OS default PDF viewer, which gives a real print preview to review and print
	// from. A bare renderer-side `window.print()` under `vscode-file://` (Electron)
	// jumps straight to the OS print dialog with NO document preview — the reported
	// bug — so we route printing through the native host instead.
	const printSummary = async () => {
		if (!summaryLoaded) {
			deps.notificationService.notify({ severity: Severity.Info, message: 'The visit summary is still loading. Please try again in a moment.' });
			return;
		}
		printBtn.disabled = true;
		try {
			await deps.nativeHostService.printPdfPreview(`encounter-${encounterId}-summary.pdf`);
		} catch (err) {
			deps.notificationService.notify({ severity: Severity.Error, message: `Could not open the print preview: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			printBtn.disabled = false;
		}
	};

	pdfBtn.addEventListener('click', () => void downloadPdf());
	printBtn.addEventListener('click', () => void printSummary());

	void loadVisitSummary(deps, patientId, encounterId, content, loading, facilityHint, patientName, headCell).then(ok => { summaryLoaded = ok; });
}

/** Data the repeating print letterhead shows. Any empty field is omitted. */
interface LetterheadData {
	patientName: string;
	dob?: string;
	age?: string;
	phone?: string;
	visitDate?: string;
	practiceName?: string;
	practiceAddress?: string;
	practicePhone?: string;
	practiceFax?: string;
	providerName?: string;
	referringProvider?: string;
}

/** Coerce a possibly-nested API value (string / {display,name,text} / array) to
 *  a trimmed display string. Module-level twin of the local helper used by
 *  sanitizeSummaryMeta, reused by the letterhead assembly. */
function asText(v: unknown): string {
	if (v === null || v === undefined) { return ''; }
	if (typeof v === 'string') { return v.trim(); }
	if (typeof v === 'number') { return String(v); }
	if (Array.isArray(v)) { return v.map(asText).filter(Boolean)[0] || ''; }
	if (typeof v === 'object') {
		const o = v as Record<string, unknown>;
		return asText(o.display) || asText(o.name) || asText(o.text) || asText(o.value);
	}
	return '';
}

/** Format a date-of-birth (ISO string or `[y,m,d]`) as `YYYY-MM-DD`. */
function fmtDob(raw: unknown): string {
	if (!raw) { return ''; }
	if (Array.isArray(raw)) {
		const [y, m, d] = raw as number[];
		if (!y) { return ''; }
		return `${y}-${String(m || 1).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
	}
	const s = String(raw);
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
	return m ? `${m[1]}-${m[2]}-${m[3]}` : s;
}

/** Whole-year age from a date-of-birth, formatted `N yrs`. Empty when unparseable. */
function ageFromDob(raw: unknown): string {
	if (!raw) { return ''; }
	let d: Date;
	if (Array.isArray(raw)) { const [y, m, day] = raw as number[]; d = new Date(y, (m || 1) - 1, day || 1); }
	else { d = new Date(String(raw)); }
	if (isNaN(d.getTime())) { return ''; }
	const now = new Date();
	let age = now.getFullYear() - d.getFullYear();
	const mo = now.getMonth() - d.getMonth();
	if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) { age--; }
	if (age < 0 || age > 150) { return ''; }
	return `${age} yrs`;
}

/** Format a US phone number as `XXX-XXX-XXXX`; passes through anything else. */
function fmtPhone(raw: unknown): string {
	if (!raw) { return ''; }
	const digits = String(raw).replace(/\D/g, '');
	if (digits.length === 10) { return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`; }
	if (digits.length === 11 && digits[0] === '1') { return `${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`; }
	return String(raw).trim();
}

/** Format a service date/time as `MM/DD/YYYY hh:mm AM` (date only when no time). */
function fmtDateTime(raw: unknown): string {
	if (!raw) { return ''; }
	const s = String(raw);
	const d = new Date(s);
	if (isNaN(d.getTime())) { return s; }
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	const date = `${mm}/${dd}/${d.getFullYear()}`;
	if (!/[T ]\d{1,2}:\d{2}/.test(s)) { return date; }
	let h = d.getHours();
	const min = String(d.getMinutes()).padStart(2, '0');
	const ap = h >= 12 ? 'PM' : 'AM';
	h = h % 12; if (h === 0) { h = 12; }
	return `${date} ${String(h).padStart(2, '0')}:${min} ${ap}`;
}

/** Build a one-line practice street address from the practice profile fields. */
function practiceAddress(p: Record<string, unknown> | null | undefined): string {
	if (!p) { return ''; }
	const cityState = [asText(p.city), [asText(p.state), asText(p.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	return [asText(p.addressLine1), asText(p.addressLine2), cityState].filter(Boolean).join(', ');
}

/** GET the patient record (name / DOB / phone) for the letterhead banner. */
async function loadPatientDemographics(deps: IVisitSummaryDeps, patientId: string): Promise<Record<string, unknown> | null> {
	const r = await deps.apiService.fetch(`/api/patients/${patientId}`);
	if (!r.ok) { return null; }
	const j = await r.json().catch(() => null);
	return (j?.data ?? j ?? null) as Record<string, unknown> | null;
}

/** GET the practice profile (name / address / phone / fax) for the letterhead. */
async function loadPracticeInfo(deps: IVisitSummaryDeps): Promise<Record<string, unknown> | null> {
	const r = await deps.apiService.fetch('/api/fhir-resource/practice?page=0&size=1');
	if (!r.ok) { return null; }
	const j = await r.json().catch(() => null);
	const data = (j?.data ?? j) as Record<string, unknown> | undefined;
	const list = (data?.content ?? data ?? []) as Array<Record<string, unknown>>;
	if (Array.isArray(list)) { return list[0] ?? null; }
	return (data ?? null) as Record<string, unknown> | null;
}

/** Resolve the patient's referring provider — a property of the Referral
 *  resource, not the encounter. Uses the patient's most-recent referral. */
async function loadReferringProvider(deps: IVisitSummaryDeps, patientId: string): Promise<string> {
	const r = await deps.apiService.fetch('/api/referrals');
	if (!r.ok) { return ''; }
	const j = await r.json().catch(() => null);
	const data = (j?.data ?? j) as Record<string, unknown> | undefined;
	const list = (data?.content ?? data ?? []) as Array<Record<string, unknown>>;
	if (!Array.isArray(list) || !list.length) { return ''; }
	const forPatient = list.filter(x => String(x.patientId ?? '').replace(/^Patient\//i, '') === String(patientId));
	if (!forPatient.length) { return ''; }
	forPatient.sort((a, b) => new Date(String(b.referralDate ?? '')).getTime() - new Date(String(a.referralDate ?? '')).getTime());
	const ref = forPatient[0];
	return asText(ref.referringProvider) || asText(ref.referringProviderName) || asText(ref.referringPrescriber);
}

/** Renders the repeating Visit Note letterhead into the print table's <thead>
 *  cell: a patient banner (NAME • DOB • Age • Phone • Visit Date) over a
 *  practice block (practice name / address / Phone • Fax on the left, and
 *  Patient / Provider / Visit Date / Referring Provider on the right), each
 *  underlined with a bold rule. Hidden on screen; repeats on every printed page. */
function renderLetterhead(headCell: HTMLElement, d: LetterheadData): void {
	headCell.textContent = '';
	headCell.style.cssText = 'font-family:var(--vscode-font-family);color:#222;';

	// --- Patient banner: NAME • DOB • Age • Phone • Visit Date ---
	const banner = DOM.append(headCell, DOM.$('div.vs-hdr-rule'));
	banner.style.cssText = 'display:flex;flex-wrap:wrap;align-items:baseline;gap:3px 14px;padding:0 0 7px;border-bottom:2px solid #222;margin-bottom:11px;';
	const name = DOM.append(banner, DOM.$('span'));
	name.textContent = (d.patientName || 'Patient').toUpperCase();
	name.style.cssText = 'font-size:13px;font-weight:700;';
	const bannerSeg = (label: string, value?: string): void => {
		if (!value) { return; }
		const wrap = DOM.append(banner, DOM.$('span'));
		wrap.style.cssText = 'font-size:12px;';
		const l = DOM.append(wrap, DOM.$('span'));
		l.textContent = `${label}: `;
		l.style.cssText = 'font-weight:700;';
		const v = DOM.append(wrap, DOM.$('span'));
		v.textContent = value;
	};
	bannerSeg('DOB', d.dob);
	bannerSeg('Age', d.age);
	bannerSeg('Phone', d.phone);
	bannerSeg('Visit Date', d.visitDate);

	// --- Practice block: practice details (left) + visit meta (right) ---
	const grid = DOM.append(headCell, DOM.$('div.vs-hdr-rule'));
	grid.style.cssText = 'display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:0 0 8px;border-bottom:2px solid #222;';

	const left = DOM.append(grid, DOM.$('div'));
	left.style.cssText = 'flex:1;min-width:0;';
	if (d.practiceName) {
		const pn = DOM.append(left, DOM.$('div'));
		pn.textContent = d.practiceName;
		pn.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:6px;';
	}
	if (d.practiceAddress) {
		const a = DOM.append(left, DOM.$('div'));
		a.textContent = d.practiceAddress;
		a.style.cssText = 'font-size:12px;margin-bottom:6px;';
	}
	const contact = DOM.append(left, DOM.$('div'));
	contact.style.cssText = 'font-size:12px;';
	const contactSeg = (label: string, value?: string): void => {
		if (!value) { return; }
		if (contact.childElementCount) {
			const sep = DOM.append(contact, DOM.$('span'));
			// allow-any-unicode-next-line
			sep.textContent = '   •   ';
		}
		const l = DOM.append(contact, DOM.$('span'));
		l.textContent = `${label}: `;
		l.style.cssText = 'font-weight:700;';
		const v = DOM.append(contact, DOM.$('span'));
		v.textContent = value;
	};
	contactSeg('Phone', d.practicePhone);
	contactSeg('Fax', d.practiceFax);

	const right = DOM.append(grid, DOM.$('div'));
	right.style.cssText = 'text-align:right;font-size:12px;flex-shrink:0;max-width:45%;';
	const rightLine = (label: string, value?: string): void => {
		if (!value) { return; }
		const row = DOM.append(right, DOM.$('div'));
		row.style.cssText = 'margin-bottom:2px;';
		const l = DOM.append(row, DOM.$('span'));
		l.textContent = `${label}: `;
		l.style.cssText = 'font-weight:700;';
		const v = DOM.append(row, DOM.$('span'));
		v.textContent = value;
	};
	rightLine('Patient', d.patientName);
	rightLine('Provider', d.providerName);
	rightLine('Visit Date', d.visitDate);
	rightLine('Referring Provider', d.referringProvider);
}

/** Fetches the encounter summary and renders it into the panel body.
 *
 *  The clinical data the user types in the encounter form (chief complaint,
 *  HPI, vitals, ROS, exam, assessment, plan, …) is persisted as a FHIR
 *  Composition via `/api/fhir-resource/encounter-form/...`. The `/summary`
 *  endpoint reads a different/derived store, so it showed stale or unrelated
 *  data (QA: "the data I entered isn't in the visit summary"). We therefore
 *  load the encounter-form Composition too and render the actual entered
 *  values from it, keeping `/summary` only for the encounter meta header. */
async function loadVisitSummary(deps: IVisitSummaryDeps, patientId: string, encounterId: string, body: HTMLElement, loading: HTMLElement, facilityHint?: string, patientName?: string, headCell?: HTMLElement): Promise<boolean> {
	try {
		const [summaryData, formComp, encResource, patient, practice, referring] = await Promise.all([
			deps.apiService.fetch(`/api/encounters/${patientId}/${encounterId}/summary`)
				.then(async r => (r.ok ? await r.json() : null))
				.then(j => (j?.success ? (j.data ?? null) : (j?.data ?? j ?? null)))
				.catch(() => null),
			loadEncounterFormComposition(deps, patientId, encounterId).catch(() => null),
			deps.apiService.fetch(`/api/fhir-resource/encounters/${encounterId}`)
				.then(async r => (r.ok ? (((await r.json())?.data ?? null) as Record<string, unknown> | null) : null))
				.catch(() => null),
			loadPatientDemographics(deps, patientId).catch(() => null),
			loadPracticeInfo(deps).catch(() => null),
			loadReferringProvider(deps, patientId).catch(() => ''),
		]);
		// Always render through a DTO that HAS a meta object, so the Encounter
		// Summary header can be enriched (provider / encounter id / demographics)
		// even when the /summary endpoint returned nothing.
		const dto = (summaryData && typeof summaryData === 'object' ? summaryData : {}) as VisitSummaryDTO;
		if (!dto.meta) { dto.meta = {}; }
		await sanitizeSummaryMeta(deps, dto, encResource, facilityHint);
		await enrichSummaryMeta(deps, dto, encResource, patientId, encounterId);
		loading.remove();

		// Build the letterhead that repeats on every printed / PDF page (the panel's
		// content table <thead>). Assembled from the patient record, the practice
		// profile, the encounter meta (visit date / provider) and the patient's
		// most-recent referral (referring provider). Best-effort — any block with no
		// data is simply omitted.
		if (headCell) {
			const meta = dto.meta;
			const prov = dto.assignedProviders?.find(p => (p.providerName || p.name));
			const providerName = (prov?.providerName || prov?.name || asText(encResource?.encounterProvider) || asText(encResource?.providerDisplay) || asText(encResource?.providerName) || '').trim();
			const visitDate = fmtDateTime(meta?.dateOfService || encounterDateFromResource(encResource));
			renderLetterhead(headCell, {
				patientName: patientName || asText(patient?.firstName) + (patient?.lastName ? ' ' + asText(patient?.lastName) : '') || 'Patient',
				dob: fmtDob(patient?.dateOfBirth),
				age: ageFromDob(patient?.dateOfBirth),
				phone: fmtPhone(patient?.phoneNumber ?? patient?.phone ?? patient?.homePhone),
				visitDate,
				practiceName: asText(practice?.name) || asText(practice?.dba),
				practiceAddress: practiceAddress(practice),
				practicePhone: fmtPhone(practice?.phone),
				practiceFax: fmtPhone(practice?.fax),
				providerName,
				referringProvider: referring,
			});
		}

		// The encounter-form Composition endpoint is PATIENT-scoped. Different
		// surfaces can hand this panel different ids for the same person (the
		// appointment's patient id vs the Encounter subject's id), so when the
		// lookup under the caller's id finds nothing, retry under the patient id
		// the Encounter resource itself points at — otherwise data charted from
		// the appointment drawer never shows in a summary opened elsewhere.
		const encPatientId = encResource ? String(encResource.patientId ?? encResource.patientRef ?? '').replace(/^Patient\//i, '').trim() : '';
		let comp = formComp;
		if (!comp && encPatientId && encPatientId !== patientId) {
			comp = await loadEncounterFormComposition(deps, encPatientId, encounterId).catch(() => null);
		}

		// Vitals are frequently charted on the Vitals page, which writes to the
		// shared FHIR vitals store — NOT the encounter-form Composition or the
		// /summary DTO — so an encounter can have vitals neither source returns
		// (QA: vitals missing from the visit summary). When the /summary DTO carries
		// no vitals, pull the reading recorded on the encounter's date from the
		// shared store and feed it through the SAME row-wise Vitals renderer, so
		// vitals show as aligned rows just like on the encounter page.
		if (!dto.vitals?.length) {
			const encDate = dto.meta?.dateOfService || encounterDateFromResource(encResource);
			const shared = await loadSharedVitals(deps, encPatientId || patientId, encDate).catch(() => null);
			if (shared) { dto.vitals = [shared]; }
		}

		// Prefer the encounter-form Composition for the clinical sections — it's
		// the source of truth for what the provider actually entered.
		const renderedForm = comp ? renderEncounterFormSections(deps, body, comp, dto) : false;

		if (!renderedForm) {
			// No form Composition yet — fall back to the /summary DTO rendering.
			if (!summaryData) {
				const errMsg = DOM.append(body, DOM.$('div'));
				errMsg.textContent = 'Unable to load encounter summary.';
				errMsg.style.cssText = `font-size:13px;color:${summaryColors(deps.themeService).error};`;
				return false;
			}
			renderVisitSummary(deps, body, dto);
		}
		return true;
	} catch (err) {
		loading.textContent = `Failed to load encounter summary: ${String(err)}`;
		loading.style.color = summaryColors(deps.themeService).error;
		return false;
	}
}

/**
 * Cleans up the /summary DTO's meta block before rendering:
 *
 * - `meta.type` arrives as the short FHIR class code ("AMB") — expand it to its
 *   full form ("Ambulatory") so the header reads like the EHR-UI.
 * - The backend sometimes puts a raw FHIR reference into `meta.facility` — QA
 *   saw "Practitioner/13892" rendered as the Facility, which is not even a
 *   location. Discard reference-shaped / empty values and re-derive the
 *   facility from the Encounter resource's location fields; a bare
 *   `Location/{id}` (or numeric location id) is resolved to its display name
 *   via the org's /api/locations list. The Encounter resource itself carries no
 *   location on this backend, so `facilityHint` (the appointment's location —
 *   the provider's location for the visit) backfills the field when the
 *   encounter yields nothing. When nothing at all resolves, the field is left
 *   empty so the row is simply omitted (better than showing a wrong value).
 */
async function sanitizeSummaryMeta(deps: IVisitSummaryDeps, summaryData: VisitSummaryDTO | null, enc: Record<string, unknown> | null, facilityHint?: string): Promise<void> {
	const meta = summaryData?.meta;
	if (!meta) { return; }
	meta.type = expandEncounterType(meta.type);
	const isRef = (s: string) => /^[A-Za-z]+\/[A-Za-z0-9-]+$/.test(s.trim());
	const asText = (v: unknown): string => {
		if (!v) { return ''; }
		if (typeof v === 'string') { return v.trim(); }
		if (Array.isArray(v)) { return v.map(asText).filter(Boolean)[0] || ''; }
		if (typeof v === 'object') {
			const o = v as Record<string, unknown>;
			return asText(o.display) || asText(o.name) || asText(o.text) || asText(o.location) || asText(o.reference);
		}
		return '';
	};
	const current = String(meta.facility ?? '').trim();
	// A plain facility NAME is fine — only reference shapes / blanks are re-derived.
	if (current && !isRef(current)) { return; }
	let candidate = '';
	if (enc) {
		candidate = asText(enc.locationName) || asText(enc.facilityName) || asText(enc.facility)
			|| asText(enc.location) || asText(enc.serviceProviderName) || asText(enc.serviceProvider);
		// Practitioner/Patient references are never facilities.
		if (/^(Practitioner|Patient|PractitionerRole|RelatedPerson)\//i.test(candidate)) { candidate = ''; }
	}
	if (!candidate && current && !/^Location\//i.test(current)) { candidate = ''; }
	// Resolve Location/{id} (or a bare numeric id) to the org location's name.
	const locIdMatch = /^Location\/([A-Za-z0-9-]+)$/i.exec(candidate) || /^Location\/([A-Za-z0-9-]+)$/i.exec(current) || (/^\d+$/.test(candidate) ? [candidate, candidate] : null);
	if (locIdMatch) {
		try {
			const r = await deps.apiService.fetch('/api/locations');
			if (r.ok) {
				const j = await r.json().catch(() => null);
				const list = (j?.data?.content ?? j?.data ?? j ?? []) as Array<Record<string, unknown>>;
				const hit = Array.isArray(list) ? list.find(l => String(l.id) === String(locIdMatch[1])) : undefined;
				if (hit) { candidate = String(hit.name || hit.locationName || candidate); }
			}
		} catch { /* keep whatever we have */ }
	}
	// The Encounter resource carries no location on this backend — fall back to
	// the visit location the caller passed (the appointment's location, i.e. the
	// provider's location for this visit).
	if ((!candidate || isRef(candidate)) && facilityHint && facilityHint.trim() && !isRef(facilityHint.trim())) {
		candidate = facilityHint.trim();
	}
	meta.facility = candidate && !isRef(candidate) ? candidate : undefined;
}

/** Formats an ISO-ish date string as MM/DD/YYYY (the app-wide date standard).
 *  Date-only strings are re-arranged textually so no timezone shift creeps in. */
function fmtSummaryDate(raw: unknown): string | undefined {
	const s = String(raw ?? '').trim();
	if (!s) { return undefined; }
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
	if (m) { return `${m[2]}/${m[3]}/${m[1]}`; }
	const d = new Date(s);
	if (isNaN(d.getTime())) { return s; }
	return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Fills the Encounter Summary header fields QA asked for beyond what the
 *  /summary DTO carries: date of service (from the Encounter resource when the
 *  DTO omits it), provider name, encounter id, and the patient's date of birth
 *  and age/gender (from /api/patients). Every lookup is best-effort — a failed
 *  fetch simply leaves that row out. */
async function enrichSummaryMeta(deps: IVisitSummaryDeps, dto: VisitSummaryDTO, enc: Record<string, unknown> | null, patientId: string, encounterId: string): Promise<void> {
	const meta = dto.meta!;
	const text = (v: unknown): string => (v === null || v === undefined) ? '' : String(v).trim();
	meta.encounterId = meta.encounterId || encounterId;

	if (!meta.dateOfService && enc) {
		const period = enc.period as Record<string, unknown> | undefined;
		meta.dateOfService = text(enc.startDate) || text(enc.encounterDate) || text(enc.date) || text(period?.start) || text(enc.createdAt) || undefined;
	}
	meta.dateOfService = fmtSummaryDate(meta.dateOfService);

	if (!meta.providerName) {
		const assigned = (dto.assignedProviders || []).map(p => text(p.providerName) || text(p.name)).find(Boolean);
		let name = assigned || (enc ? (text(enc.providerName) || text(enc.practitionerName) || text(enc.providerDisplay)) : '');
		if (/^(Practitioner|PractitionerRole)\//i.test(name)) { name = ''; }
		if (!name && enc) {
			const provId = (text(enc.providerId) || text(enc.practitionerId)).replace(/^Practitioner\//i, '');
			if (provId) {
				try {
					const r = await deps.apiService.fetch(`/api/providers/${encodeURIComponent(provId)}`);
					if (r.ok) {
						const j = await r.json().catch(() => null);
						const p = (j?.data ?? j) as Record<string, unknown> | null;
						if (p) { name = `${text(p.firstName)} ${text(p.lastName)}`.trim() || text(p.name) || text(p.providerName); }
					}
				} catch { /* provider row omitted */ }
			}
		}
		meta.providerName = name || undefined;
	}

	const pid = text(enc?.patientId).replace(/^Patient\//i, '') || patientId;
	try {
		const r = await deps.apiService.fetch(`/api/patients/${encodeURIComponent(pid)}`);
		if (r.ok) {
			const j = await r.json().catch(() => null);
			const p = (j?.data ?? j) as Record<string, unknown> | null;
			if (p) {
				const dobRaw = text(p.dateOfBirth) || text(p.birthDate) || text(p.dob);
				let agePart = '';
				if (dobRaw) {
					meta.dateOfBirth = fmtSummaryDate(dobRaw);
					const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dobRaw);
					if (m) {
						const now = new Date();
						let age = now.getFullYear() - Number(m[1]);
						if ((now.getMonth() + 1) < Number(m[2]) || ((now.getMonth() + 1) === Number(m[2]) && now.getDate() < Number(m[3]))) { age--; }
						if (age >= 0 && age < 150) { agePart = `${age} yrs`; }
					}
				}
				const genderRaw = text(p.gender) || text(p.sex);
				const genderPart = genderRaw ? genderRaw.charAt(0).toUpperCase() + genderRaw.slice(1).toLowerCase() : '';
				meta.ageGender = [agePart, genderPart].filter(Boolean).join(' / ') || undefined;
			}
		}
	} catch { /* demographics rows omitted */ }
}

/** Loads the encounter-form Composition for an encounter and returns the most
 *  recent one (the form re-creates a Composition on each save, so the highest
 *  id is the current state). Returns null when none exists yet. */
async function loadEncounterFormComposition(deps: IVisitSummaryDeps, patientId: string, encounterId: string): Promise<Record<string, unknown> | null> {
	const res = await deps.apiService.fetch(`/api/fhir-resource/encounter-form/patient/${patientId}?encounterRef=${encounterId}`);
	if (!res.ok) { return null; }
	const json = await res.json().catch(() => null);
	const data = (json && (json.data ?? json)) as Record<string, unknown> | null;
	if (!data) { return null; }
	const content = Array.isArray(data) ? data : (data.content as unknown[]) || (Array.isArray(data.data) ? data.data as unknown[] : null);
	const list = (content && Array.isArray(content) ? content : [data]) as Array<Record<string, unknown>>;
	const comps = list.filter(c => c && typeof c === 'object');
	if (!comps.length) { return null; }
	// Most recent composition = highest numeric id.
	comps.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
	return comps[0];
}

/** Extract the encounter's service date from the raw FHIR Encounter resource.
 *  The shared vitals store keys one reading per visit date, so vitals are matched
 *  to the encounter by day. Returns '' when no date field is present. */
function encounterDateFromResource(enc: Record<string, unknown> | null): string {
	if (!enc) { return ''; }
	const period = enc.period as Record<string, unknown> | undefined;
	const cand = enc.encounterDate ?? enc.startDate ?? enc.start ?? enc.dateOfService ?? enc.date ?? enc.periodStart ?? period?.start ?? period?.end;
	return cand ? String(cand) : '';
}

/** Loads the shared FHIR vitals store for the patient and returns the reading
 *  recorded on the encounter's date, mapped to the panel's vitals shape. Vitals
 *  charted on the Vitals page land here — NOT in the encounter-form Composition
 *  or the /summary DTO — so this is the source of truth when those carry none.
 *  Falls back to the most-recent reading when no reading matches the day. */
async function loadSharedVitals(deps: IVisitSummaryDeps, patientId: string, encDateRaw: string): Promise<VisitSummaryVitals | null> {
	try {
		const r = await deps.apiService.fetch(`/api/fhir-resource/vitals/patient/${patientId}?page=0&size=50`);
		if (!r.ok) { return null; }
		const j = await r.json().catch(() => null);
		const inner = (j?.data ?? j) as Record<string, unknown> | undefined;
		const arr = (inner?.content || inner?.list || inner?.items || (Array.isArray(inner) ? inner : (Array.isArray(j) ? j : []))) as Array<Record<string, unknown>>;
		if (!Array.isArray(arr) || !arr.length) { return null; }
		const timeOf = (v: Record<string, unknown>): number => {
			const d = new Date(String(v.recordedAt ?? v.effectiveDateTime ?? v.recordedDate ?? v.date ?? ''));
			return isNaN(d.getTime()) ? 0 : d.getTime();
		};
		const ref = encDateRaw ? new Date(encDateRaw) : null;
		let pool = arr;
		if (ref && !isNaN(ref.getTime())) {
			const sameDay = arr.filter(v => {
				const d = new Date(String(v.recordedAt ?? v.effectiveDateTime ?? v.recordedDate ?? v.date ?? ''));
				return !isNaN(d.getTime()) && d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
			});
			if (sameDay.length) { pool = sameDay; }
		}
		const v = pool.slice().sort((a, b) => timeOf(b) - timeOf(a))[0];
		if (!v) { return null; }
		const num = (x: unknown): number | undefined => {
			if (x === undefined || x === null || x === '') { return undefined; }
			const n = Number(x);
			return Number.isFinite(n) ? n : undefined;
		};
		const mapped: VisitSummaryVitals = {
			bpSystolic: num(v.bpSystolic),
			bpDiastolic: num(v.bpDiastolic),
			pulse: num(v.pulse),
			// The Vitals store field is named temperatureC but holds the value in
			// Fahrenheit on this workspace (the form maps vitals_temperature to
			// temperatureC), so surface it as temperatureF to render it in F,
			// matching the encounter page.
			temperatureF: num(v.temperatureF ?? v.temperatureC),
			oxygenSaturation: num(v.oxygenSaturation),
			respiration: num(v.respiration),
			weightKg: num(v.weightKg),
			weightLbs: num(v.weightLbs),
			heightCm: num(v.heightCm),
			heightIn: num(v.heightIn),
			bmi: num(v.bmi),
			notes: typeof v.notes === 'string' && v.notes.trim() ? v.notes.trim() : undefined,
			recordedAt: v.recordedAt ? String(v.recordedAt) : (v.effectiveDateTime ? String(v.effectiveDateTime) : undefined),
		};
		// Nothing meaningful was recorded → treat as no vitals.
		const hasAny = [mapped.bpSystolic, mapped.bpDiastolic, mapped.pulse, mapped.temperatureF, mapped.oxygenSaturation, mapped.respiration, mapped.weightKg, mapped.heightCm, mapped.bmi].some(x => x !== undefined);
		return hasAny ? mapped : null;
	} catch {
		return null;
	}
}

/** Section groups for the encounter-form Composition, keyed by the field-name
 *  prefix the form uses (cc_*, hpi_*, vitals_*, …). Mirrors the encounter form's
 *  own section order so the summary reads top-to-bottom like the chart. */
const FORM_SECTION_GROUPS: Array<{ prefix: string; title: string; icon: string }> = [
	// allow-any-unicode-next-line
	{ prefix: 'cc', title: 'Chief Complaint', icon: '🩺' },
	// allow-any-unicode-next-line
	{ prefix: 'hpi', title: 'History of Present Illness', icon: '📖' },
	// allow-any-unicode-next-line
	{ prefix: 'ros', title: 'Review of Systems', icon: '🔍' },
	// allow-any-unicode-next-line
	{ prefix: 'vitals', title: 'Vitals', icon: '❤️' },
	// allow-any-unicode-next-line
	{ prefix: 'pe', title: 'Physical Exam', icon: '🧍' },
	// allow-any-unicode-next-line
	{ prefix: 'pmh', title: 'Past Medical / Surgical History', icon: '📋' },
	// allow-any-unicode-next-line
	{ prefix: 'fh', title: 'Family History', icon: '👪' },
	// allow-any-unicode-next-line
	{ prefix: 'sh', title: 'Social History', icon: '🏠' },
	// allow-any-unicode-next-line
	{ prefix: 'assessment', title: 'Assessment & Diagnosis', icon: '🧠' },
	// allow-any-unicode-next-line
	{ prefix: 'plan', title: 'Plan', icon: '📝' },
	// allow-any-unicode-next-line
	{ prefix: 'provider', title: 'Provider Notes', icon: '🖊️' },
	// allow-any-unicode-next-line
	{ prefix: 'procedures', title: 'Procedures & Coding', icon: '⚕️' },
];

/** Titled section card with an accented header band. Returns the body element
 *  the caller appends rows into. QA asked for the summary to read as clean,
 *  aligned rows instead of dense "Label: value" prose — every section shares
 *  this card + the striped `summaryKvRow` layout below. */
/** Format a timestamp as `MM/DD/YYYY h:mm AM/PM` for the signature block. */
function formatPrintDateTime(d: Date): string {
	const pad = (n: number): string => String(n).padStart(2, '0');
	let h = d.getHours();
	const ampm = h >= 12 ? 'PM' : 'AM';
	h = h % 12; if (h === 0) { h = 12; }
	return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ${h}:${pad(d.getMinutes())} ${ampm}`;
}

/** Sign-off block mirroring the reference letterhead: a signature line with the
 *  provider's typed name, "Signed off By", and the print date/time. Rendered at
 *  the end of the summary (both the DTO and the encounter-form render paths call
 *  this) whenever a provider is known. */
function renderSignatureBlock(deps: IVisitSummaryDeps, body: HTMLElement, providerName: string, status?: string, signedAt?: string): void {
	const col = summaryColors(deps.themeService);
	const name = (providerName || '').trim();
	const card = summarySectionCard(body, col, 'Provider Signature');
	if (status) { summaryKvRow(card, col, 'Status', status); }
	if (signedAt) { summaryKvRow(card, col, 'Signed at', signedAt); }
	const block = DOM.append(card, DOM.$('div'));
	block.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:3px;padding:16px 16px 12px;';
	const provLabel = DOM.append(block, DOM.$('div'));
	provLabel.textContent = 'Provider';
	provLabel.style.cssText = `font-size:12px;font-weight:700;color:${col.desc};margin-bottom:20px;`;
	const rule = DOM.append(block, DOM.$('div.vs-sig-rule'));
	rule.style.cssText = `width:230px;border-top:1px solid ${col.fg};`;
	const sigNameEl = DOM.append(block, DOM.$('div'));
	sigNameEl.textContent = name || '—';
	sigNameEl.style.cssText = `font-size:13px;font-weight:600;color:${col.fg};`;
	const signedBy = DOM.append(block, DOM.$('div'));
	signedBy.textContent = `Signed off By: ${name || '—'}`;
	signedBy.style.cssText = `font-size:12px;color:${col.desc};margin-top:4px;`;
	const printedAt = DOM.append(block, DOM.$('div'));
	printedAt.textContent = `Print Date and Time: ${formatPrintDateTime(new Date())}`;
	printedAt.style.cssText = `font-size:11px;color:${col.desc};`;
}

function summarySectionCard(body: HTMLElement, col: SummaryColors, title: string, icon?: string): HTMLElement {
	// A borderless section (design feedback: no boxed card per section): a bold
	// uppercase heading underlined with a thin rule, then the section's rows
	// flush below it — reads like a formal clinical note. `vs-card` still keeps
	// each section on a single page in print (break-inside:avoid) so a section
	// never splits across two pages.
	const section = DOM.append(body, DOM.$('div.vs-card'));
	section.style.cssText = 'margin-bottom:18px;';
	const head = DOM.append(section, DOM.$('div'));
	head.style.cssText = `display:flex;align-items:center;gap:7px;padding:0 0 5px;border-bottom:1px solid ${col.border};margin-bottom:5px;`;
	if (icon) {
		const ic = DOM.append(head, DOM.$('span'));
		ic.textContent = icon;
		ic.style.cssText = 'font-size:13px;line-height:1;';
	}
	const t = DOM.append(head, DOM.$('span'));
	t.textContent = title;
	t.style.cssText = `font-size:12px;font-weight:700;color:${col.fg};letter-spacing:0.05em;text-transform:uppercase;`;
	return DOM.append(section, DOM.$('div'));
}

/** One aligned label / value row inside a section card. Rows zebra-stripe so
 *  long sections stay scannable. */
function summaryKvRow(table: HTMLElement, col: SummaryColors, label: string, value: string): void {
	const row = DOM.append(table, DOM.$('div'));
	row.style.cssText = `display:grid;grid-template-columns:190px 1fr;gap:12px;padding:4px 2px;align-items:start;`;
	const l = DOM.append(row, DOM.$('span'));
	l.textContent = label;
	l.style.cssText = `font-size:12px;font-weight:600;color:${col.desc};padding-top:1px;`;
	const v = DOM.append(row, DOM.$('span'));
	v.textContent = value;
	v.style.cssText = `font-size:13px;color:${col.fg};white-space:pre-wrap;word-break:break-word;`;
}

/** Renders vitals as a TWO-COLUMN grid — two label/value pairs per visual row —
 *  so the compact numeric readings read like the encounter page's vitals grid
 *  instead of one measurement per full-width row (QA: vitals should be 2-column).
 *  Long / free-text entries (Notes, Recorded) span the full width below the grid.
 *  Rows zebra-stripe by visual row so paired cells share one background band. */
function renderVitalsGrid(table: HTMLElement, col: SummaryColors, rows: Array<[string, string]>): void {
	const isWide = ([label, value]: [string, string]): boolean => label === 'Notes' || label === 'Recorded' || value.length > 32;
	const pairs = rows.filter(r => !isWide(r));
	const wide = rows.filter(isWide);
	if (pairs.length) {
		const grid = DOM.append(table, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;column-gap:24px;';
		pairs.forEach(([label, value]) => {
			const cell = DOM.append(grid, DOM.$('div'));
			cell.style.cssText = `display:grid;grid-template-columns:120px 1fr;gap:10px;align-items:start;padding:4px 2px;`;
			const l = DOM.append(cell, DOM.$('span'));
			l.textContent = label;
			l.style.cssText = `font-size:12px;font-weight:600;color:${col.desc};padding-top:1px;`;
			const v = DOM.append(cell, DOM.$('span'));
			v.textContent = value;
			v.style.cssText = `font-size:13px;color:${col.fg};white-space:pre-wrap;word-break:break-word;`;
		});
	}
	for (const [label, value] of wide) { summaryKvRow(table, col, label, value); }
}

/** Full-width free-text row (used for single-value sections like the chief
 *  complaint, where a label column would only repeat the section title). */
function summaryTextRow(table: HTMLElement, col: SummaryColors, text: string): void {
	const row = DOM.append(table, DOM.$('div'));
	row.textContent = text;
	row.style.cssText = `padding:4px 2px;font-size:13px;color:${col.fg};white-space:pre-wrap;word-break:break-word;`;
}

/** The "Encounter Summary" meta header card, shared by both render paths. */
function renderSummaryMetaCard(body: HTMLElement, col: SummaryColors, meta: VisitSummaryMeta): void {
	// allow-any-unicode-next-line
	const table = summarySectionCard(body, col, 'Encounter Summary', '📄');
	const metaFields: Array<[string, string | undefined]> = [
		['Visit Category', meta.visitCategory],
		['Type', meta.type],
		['Facility', meta.facility],
		['Date of Service', meta.dateOfService],
		['Provider', meta.providerName],
		['Encounter ID', meta.encounterId],
		['Date of Birth', meta.dateOfBirth],
		['Age / Gender', meta.ageGender],
		['Reason for Visit', meta.reasonForVisit],
	];
	let anyMeta = false;
	for (const [label, value] of metaFields) {
		if (!value) { continue; }
		anyMeta = true;
		summaryKvRow(table, col, label, String(value));
	}
	if (!anyMeta) {
		summaryTextRow(table, col, 'No encounter details recorded.');
	}
}

/** Vitals display order + units for the Visit Summary, matching the encounter
 *  form's vitals section (QA: units must show and the order must match the
 *  encounter page). `keys` lists the canonical Composition key first, then the
 *  backend's short aliases. */
const VITALS_DISPLAY: Array<{ keys: string[]; label: string; unit: string }> = [
	{ keys: ['vitals_bp_systolic'], label: 'BP Systolic', unit: 'mmHg' },
	{ keys: ['vitals_bp_diastolic'], label: 'BP Diastolic', unit: 'mmHg' },
	{ keys: ['vitals_heart_rate', 'vitals_hr'], label: 'Heart Rate', unit: 'bpm' },
	// allow-any-unicode-next-line
	{ keys: ['vitals_temperature', 'vitals_temp'], label: 'Temperature', unit: '°F' },
	{ keys: ['vitals_spo2', 'vitals_spo'], label: 'SpO2', unit: '%' },
	{ keys: ['vitals_respiratory_rate', 'vitals_rr'], label: 'Respiratory Rate', unit: '/min' },
	{ keys: ['vitals_weight'], label: 'Weight', unit: 'kg' },
	{ keys: ['vitals_height'], label: 'Height', unit: 'cm' },
	{ keys: ['vitals_bmi'], label: 'BMI', unit: '' },
	{ keys: ['vitals_notes'], label: 'Notes', unit: '' },
];

/** Humanize a Composition field key into a readable label, stripping the
 *  section prefix and upper-casing common clinical abbreviations. */
function humanizeFieldKey(key: string, prefix: string): string {
	let rest = key.startsWith(prefix + '_') ? key.slice(prefix.length + 1) : key;
	if (!rest) { rest = key; }
	const abbr: Record<string, string> = { bp: 'BP', spo2: 'SpO2', bmi: 'BMI', hr: 'HR', rr: 'RR', icd: 'ICD', cpt: 'CPT', ros: 'ROS', pe: 'PE', hpi: 'HPI' };
	return rest.split('_').map(w => abbr[w.toLowerCase()] || (w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

/** Renders the encounter-form Composition (the provider's actual entries) into
 *  the panel, grouped into the same sections as the chart. Returns true when at
 *  least one clinical value was rendered. */
function renderEncounterFormSections(deps: IVisitSummaryDeps, body: HTMLElement, comp: Record<string, unknown>, summaryData: unknown): boolean {
	const col = summaryColors(deps.themeService);

	// --- Encounter Summary (meta) header, reusing the /summary meta when present.
	const meta = (summaryData && typeof summaryData === 'object' ? (summaryData as VisitSummaryDTO).meta : undefined) || {};
	renderSummaryMetaCard(body, col, meta);

	// Format a single field value for display; returns '' to skip the field.
	const fmtValue = (key: string, raw: unknown): string => {
		if (raw === null || raw === undefined || raw === '') { return ''; }
		if (typeof raw === 'boolean') { return raw ? (/_normal$/.test(key) ? 'Normal' : 'Yes') : ''; }
		if (Array.isArray(raw)) {
			if (raw.length === 0) { return ''; }
			return raw.map(it => {
				if (it && typeof it === 'object') {
					const o = it as Record<string, unknown>;
					const code = o.code ?? o.cpt4 ?? o.cpt ?? o.icd ?? o.icd10 ?? '';
					const desc = o.description ?? o.text ?? o.name ?? o.label ?? '';
					let joined = [code, desc].filter(Boolean).join(' - ');
					// Structured plan items carry { type, description, notes } —
					// surface the type as a prefix and the notes as a suffix.
					const typ = String(o.type ?? '').trim();
					if (joined && typ && typ.toLowerCase() !== 'other') {
						joined = `[${typ.charAt(0).toUpperCase()}${typ.slice(1)}] ${joined}`;
					}
					const notes = String(o.notes ?? '').trim();
					if (joined && notes) { joined += ` — ${notes}`; }
					return joined || JSON.stringify(o);
				}
				return String(it);
			}).join('; ');
		}
		if (typeof raw === 'object') {
			const o = raw as Record<string, unknown>;
			const parts = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
				.map(([k, v]) => `${k}: ${String(v)}`);
			return parts.join(', ');
		}
		return String(raw);
	};

	// Keys that are metadata, not clinical content.
	const isMetaKey = (k: string): boolean => /^_/.test(k) || /^(id|fhirId|resourceType|lastUpdated|encounterRef|encounterId|patientId|status|version|createdAt|updatedAt|author|title|date)$/i.test(k);

	const allKeys = Object.keys(comp).filter(k => !isMetaKey(k));
	const usedKeys = new Set<string>();
	const renderedTitles = new Set<string>();
	let renderedAny = false;

	for (const grp of FORM_SECTION_GROUPS) {
		// Fields whose key is exactly the prefix or starts with `${prefix}_`.
		const keys = allKeys.filter(k => k === grp.prefix || k.startsWith(grp.prefix + '_'));
		const rows: Array<[string, string]> = [];
		if (grp.prefix === 'vitals') {
			// Vitals: render in the SAME order as the encounter page and append the
			// unit to each value (QA: units must show, order must match). Alias keys
			// cover the backend's short forms (vitals_hr / vitals_temp / …).
			for (const spec of VITALS_DISPLAY) {
				let raw: unknown;
				let hitKey = '';
				for (const kk of spec.keys) {
					usedKeys.add(kk);
					const cv = comp[kk];
					if (raw === undefined && cv !== undefined && cv !== null && cv !== '') { raw = cv; hitKey = kk; }
				}
				if (raw === undefined) { continue; }
				const v = fmtValue(hitKey, raw);
				if (v) { rows.push([spec.label, spec.unit ? `${v} ${spec.unit}` : v]); }
			}
			// Then append ANY other vitals the encounter carries that are not in the
			// canonical list (e.g. legacy `vitals_pain_level`, or a nested `vitals`
			// object) so nothing charted is dropped — the ordered list above is an
			// enhancement, not a whitelist that hides extra fields.
			for (const k of keys) {
				if (usedKeys.has(k)) { continue; }
				const v = fmtValue(k, comp[k]);
				if (v) { rows.push([humanizeFieldKey(k, grp.prefix), v]); usedKeys.add(k); }
			}
		} else {
			for (const k of keys) {
				// Physical Exam: skip the per-system "Normal" checkbox scaffolding and
				// the raw `pe_data` grid container, but DO render every system's
				// findings — including default-normal text — so the Physical Exam
				// section always appears in the summary (QA: it was hidden when every
				// system was left at its normal template).
				if (grp.prefix === 'pe') {
					if (/_normal$/.test(k) || k === 'pe_data') { usedKeys.add(k); continue; }
				}
				const v = fmtValue(k, comp[k]);
				if (v) { rows.push([humanizeFieldKey(k, grp.prefix), v]); usedKeys.add(k); }
			}
		}
		if (!rows.length) { continue; }
		renderedAny = true;
		renderedTitles.add(grp.title);
		const table = summarySectionCard(body, col, grp.title, grp.icon);
		// Chief complaint is a single free-text value — show it without a label.
		if (grp.prefix === 'cc' && rows.length === 1) {
			summaryTextRow(table, col, rows[0][1]);
		} else if (grp.prefix === 'vitals') {
			// Vitals render as a two-column grid of measurement pairs.
			renderVitalsGrid(table, col, rows);
		} else {
			for (const [label, value] of rows) {
				summaryKvRow(table, col, label, value);
			}
		}
	}

	// Fall back to the /summary DTO for prominent sections the Composition didn't
	// carry. Vitals in particular are often charted on the Vitals page (they land
	// in the shared FHIR store the /summary reads, NOT the encounter form), so an
	// encounter whose Composition has no vitals must still show them (QA: vitals /
	// other fields missing from the summary). Chief Complaint and HPI get the same
	// treatment for the same reason.
	if (summaryData && typeof summaryData === 'object') {
		renderedAny = renderMissingDtoSections(deps, body, summaryData as VisitSummaryDTO, renderedTitles) || renderedAny;
	}

	// Sign-off block — the reference letterhead always closes with a provider
	// signature. Rendered when the encounter has content and a known provider.
	if (renderedAny && meta.providerName) {
		renderSignatureBlock(deps, body, meta.providerName);
	}

	if (!renderedAny) {
		const none = DOM.append(body, DOM.$('div'));
		none.textContent = 'No clinical sections recorded for this encounter yet.';
		none.style.cssText = `padding:10px 2px;font-size:13px;color:${col.desc};font-style:italic;`;
	}
	return true;
}

/** Vitals rows (label + value with unit) built from a /summary DTO vitals entry,
 *  in the same order and units as the Composition-path vitals. */
function vitalsRowsFromDto(v: VisitSummaryVitals): Array<[string, string]> {
	const rows: Array<[string, string]> = [];
	const push = (label: string, val: unknown, unit: string): void => {
		if (val === undefined || val === null || val === '') { return; }
		rows.push([label, unit ? `${val} ${unit}` : String(val)]);
	};
	push('BP Systolic', v.bpSystolic, 'mmHg');
	push('BP Diastolic', v.bpDiastolic, 'mmHg');
	push('Heart Rate', v.pulse, 'bpm');
	// allow-any-unicode-next-line
	if (v.temperatureF !== undefined && v.temperatureF !== null) { push('Temperature', v.temperatureF, '°F'); } else { push('Temperature', v.temperatureC, '°C'); }
	push('SpO2', v.oxygenSaturation, '%');
	push('Respiratory Rate', v.respiration, '/min');
	if (v.weightKg !== undefined && v.weightKg !== null) { push('Weight', v.weightKg, 'kg'); } else { push('Weight', v.weightLbs, 'lbs'); }
	if (v.heightCm !== undefined && v.heightCm !== null) { push('Height', v.heightCm, 'cm'); } else { push('Height', v.heightIn, 'in'); }
	push('BMI', v.bmi, '');
	return rows;
}

/** Renders the prominent clinical sections (Vitals, Chief Complaint, HPI,
 *  Review of Systems) from the /summary DTO when the encounter-form Composition
 *  did NOT already provide them, so a sparse Composition doesn't hide data that
 *  exists in the shared store. Returns true when at least one fallback section
 *  was rendered. */
function renderMissingDtoSections(deps: IVisitSummaryDeps, body: HTMLElement, dto: VisitSummaryDTO, rendered: Set<string>): boolean {
	const col = summaryColors(deps.themeService);
	let any = false;

	// --- Vitals ---
	if (!rendered.has('Vitals')) {
		const v0 = Array.isArray(dto.vitals) ? dto.vitals.find(Boolean) : undefined;
		const rows = v0 ? vitalsRowsFromDto(v0) : [];
		if (rows.length) {
			// allow-any-unicode-next-line
			const table = summarySectionCard(body, col, 'Vitals', '❤️');
			renderVitalsGrid(table, col, rows);
			any = true;
		}
	}
	// --- Chief Complaint ---
	if (!rendered.has('Chief Complaint')) {
		const texts = (Array.isArray(dto.chiefComplaints) ? dto.chiefComplaints : [])
			.map(c => [c.title || c.complaint || '', c.notes || ''].filter(Boolean).join('\n')).filter(Boolean);
		if (texts.length) {
			// allow-any-unicode-next-line
			const table = summarySectionCard(body, col, 'Chief Complaint', '🩺');
			for (const t of texts) { summaryTextRow(table, col, t); }
			any = true;
		}
	}
	// --- History of Present Illness ---
	if (!rendered.has('History of Present Illness')) {
		const texts = (Array.isArray(dto.hpi) ? dto.hpi : [])
			.map(h => h.description || h.text || h.notes || '').filter(Boolean);
		if (texts.length) {
			// allow-any-unicode-next-line
			const table = summarySectionCard(body, col, 'History of Present Illness', '📖');
			for (const t of texts) { summaryTextRow(table, col, t); }
			any = true;
		}
	}
	// --- Review of Systems ---
	if (!rendered.has('Review of Systems')) {
		const rosVisible = (Array.isArray(dto.ros) ? dto.ros : [])
			.filter(r => (r.findings && r.findings.length > 0) || !r.isNegative);
		if (rosVisible.length) {
			// allow-any-unicode-next-line
			const table = summarySectionCard(body, col, 'Review of Systems', '🔍');
			for (const r of rosVisible) {
				const detail = (r.findings && r.findings.length) ? r.findings.join(', ') : 'All Negative';
				summaryKvRow(table, col, r.systemName || 'System', r.notes ? `${detail} — ${r.notes}` : detail);
			}
			any = true;
		}
	}
	return any;
}

/** Renders the full Encounter Summary (meta + every recorded section) from the
 *  EncounterSummaryDto returned by the backend. Mirrors the EHR-UI
 *  `Encountersummary` layout. */
function renderVisitSummary(deps: IVisitSummaryDeps, body: HTMLElement, data: VisitSummaryDTO): void {
	const col = summaryColors(deps.themeService);

	// A titled card the section renderers append their content into (shared
	// accented-header + striped-row layout — QA asked for row-wise data).
	const section = (title: string, icon?: string): HTMLElement => summarySectionCard(body, col, title, icon);
	// A "label / value" row; skipped entirely when the value is empty.
	const line = (parent: HTMLElement, label: string, value: unknown): void => {
		if (value === undefined || value === null || value === '') { return; }
		summaryKvRow(parent, col, label, String(value));
	};
	// A simple bulleted line of text.
	const bullet = (parent: HTMLElement, text: string): void => {
		// allow-any-unicode-next-line
		summaryTextRow(parent, col, `• ${text}`);
	};

	// --- Encounter Summary (meta) card ---
	renderSummaryMetaCard(body, col, data.meta || {});

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
		// allow-any-unicode-next-line
		const card = section('Chief Complaint', '🩺');
		for (const cc of data.chiefComplaints) {
			const title = cc.title || cc.complaint || 'Chief Complaint';
			summaryTextRow(card, col, cc.notes ? `${title}\n${cc.notes}` : title);
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
			block.style.cssText = `border-left:2px solid ${col.border};padding-left:10px;margin:4px 0 12px;`;
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
				row.style.cssText = 'font-size:13px;';
				const head = DOM.append(row, DOM.$('div'));
				head.style.cssText = `color:${col.fg};font-weight:600;padding:6px 2px 0;`;
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
		// Two-column grid of measurement pairs, in the SAME order / labels / units as
		// the encounter page and the other render paths (QA: vitals 2-column), so the
		// summary reads identically no matter which path produced it. Temperature is
		// charted in \u00B0F on this workspace (the form maps vitals_temperature \u2192
		// temperatureC), which vitalsRowsFromDto already surfaces as \u00B0F.
		for (const v of data.vitals) {
			const rows = vitalsRowsFromDto(v);
			if (v.notes) { rows.push(['Notes', String(v.notes)]); }
			if (v.recordedAt) { rows.push(['Recorded', String(v.recordedAt)]); }
			renderVitalsGrid(card, col, rows);
		}
	}

	// --- Physical Exam ---
	if (data.physicalExam?.length) {
		renderedAny = true;
		const card = section('Physical Exam');
		for (const p of data.physicalExam) {
			const block = DOM.append(card, DOM.$('div'));
			block.style.cssText = `border-left:2px solid ${col.border};padding-left:10px;margin:4px 0 12px;`;
			if (p.summary) { line(block, 'Summary', p.summary); }
			for (const s of p.sections || []) {
				const head = DOM.append(block, DOM.$('div'));
				head.style.cssText = `color:${col.fg};font-weight:600;padding:6px 2px 0;`;
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
			block.style.cssText = `border-left:2px solid ${col.border};padding-left:10px;margin:4px 0 12px;`;
			line(block, 'Diagnostic Plan', p.diagnosticPlan);
			line(block, 'Plan', p.plan);
			line(block, 'Notes', p.notes);
			if (p.followUpVisit) { line(block, 'Follow-Up Visit', String(p.followUpVisit)); }
			if (p.returnWorkSchool) { line(block, 'Return Work/School', String(p.returnWorkSchool)); }
		}
	}

	// --- Provider Signature ---
	// A sign-off block mirroring the reference letterhead: the DTO status / signed-at
	// (when present), then a signature line with the provider's typed name, "Signed
	// off By", and the print date/time. Rendered whenever a provider is known so the
	// summary always carries a signature area.
	const sig = data.providerSignature;
	const sigName = (sig?.signedBy || data.meta?.providerName || '').trim();
	if (sigName || sig) {
		renderedAny = true;
		renderSignatureBlock(deps, body, sigName, sig?.status, sig?.signedAt);
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
		none.style.cssText = `padding:10px 2px;font-size:13px;color:${col.desc};font-style:italic;`;
	}
}
