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
	const loading = DOM.append(body, DOM.$('div'));
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

	const dismiss = () => { try { doc.body.removeChild(backdrop); } catch { /* ignore */ } };
	closeBtn.addEventListener('click', dismiss);
	backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { dismiss(); } });

	// Tracks whether the summary finished loading, so the print / PDF actions can
	// refuse to operate on a still-loading panel.
	let summaryLoaded = false;

	// Both "Download PDF" and "Print" open the SAME in-app print preview. The
	// preview clones the LIVE summary `body` that is rendered above (the encounter-
	// form Composition — the provider's actual entries), so the saved PDF always
	// contains THIS encounter's data. Previously "Download PDF" fetched a
	// server-generated PDF from `/summary/print`, which reads the derived /summary
	// store and therefore returned a generic/empty encounter that did not match
	// what the panel showed. Routing both buttons through the live-DOM preview
	// guarantees the PDF == the panel for the specific patient/encounter being viewed.
	const openPreview = () => {
		if (!summaryLoaded) {
			deps.notificationService.notify({ severity: Severity.Info, message: 'The visit summary is still loading. Please try again in a moment.' });
			return;
		}
		// Electron's renderer `window.print()` opens the OS dialog with no preview
		// ("This app doesn't support print preview"). We render our own visible
		// preview of the live summary first, then let the user trigger the OS
		// Print / Save-as-PDF dialog from inside it.
		showSummaryPrintPreview(deps.themeService, doc, body, patientName, encounterId);
	};
	pdfBtn.addEventListener('click', openPreview);
	printBtn.addEventListener('click', openPreview);

	void loadVisitSummary(deps, patientId, encounterId, body, loading).then(ok => { summaryLoaded = ok; });
}

/** Shows a visible print-preview of the visit summary and lets the user invoke
 *  the OS Print / Save-as-PDF dialog from it. The OS print dialog cannot render a
 *  preview on its own in Electron, so we render one in-app by cloning the
 *  already-rendered summary body (render-path agnostic — it is the LIVE panel
 *  content for THIS encounter, so the printed PDF always matches the panel).
 *
 *  The on-screen preview shell is theme-aware (it follows the active light/dark
 *  workbench theme instead of always painting a hard-coded white card). The
 *  actual paper / saved-PDF output is always forced to legible black-on-white via
 *  the `@media print` block below, so a dark theme still prints a readable page. */
function showSummaryPrintPreview(themeService: IThemeService, doc: Document, sourceBody: HTMLElement, patientName: string, encounterId: string): void {
	const col = summaryColors(themeService);

	// Modal backdrop — full-viewport dimmer; click outside to dismiss.
	const backdrop = DOM.append(doc.body, DOM.$('div.ciyex-summary-print-backdrop'));
	backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';

	const sheet = DOM.append(backdrop, DOM.$('div.ciyex-summary-print-sheet'));
	sheet.style.cssText = `background:${col.bg};color:${col.fg};width:min(820px,92vw);max-height:90vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.4);display:flex;flex-direction:column;overflow:hidden;font-family:var(--vscode-font-family,sans-serif);`;

	const toolbar = DOM.append(sheet, DOM.$('div.ciyex-summary-print-toolbar'));
	toolbar.style.cssText = `display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid ${col.border};background:${col.widgetBg};flex-shrink:0;`;
	const toolbarTitle = DOM.append(toolbar, DOM.$('span'));
	// allow-any-unicode-next-line
	toolbarTitle.textContent = `Print Preview — ${patientName}`;
	toolbarTitle.style.cssText = `font-size:13px;font-weight:600;color:${col.fg};flex:1;`;
	const doPrintBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
	doPrintBtn.textContent = 'Print / Save as PDF';
	doPrintBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
	const closePrintBtn = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
	closePrintBtn.textContent = 'Close';
	closePrintBtn.style.cssText = `padding:6px 14px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,${col.fg});border:1px solid ${col.border};border-radius:4px;cursor:pointer;font-size:12px;`;

	const preview = DOM.append(sheet, DOM.$('div.ciyex-summary-print-preview'));
	preview.style.cssText = `overflow:auto;padding:24px 28px;flex:1;background:${col.bg};`;
	const heading = DOM.append(preview, DOM.$('h2'));
	// allow-any-unicode-next-line
	heading.textContent = `Visit Summary — ${patientName}`;
	heading.style.cssText = `margin:0 0 16px;font-size:18px;color:${col.fg};`;
	// Clone the live summary so the preview matches EXACTLY whatever was rendered
	// for this encounter (form Composition or /summary DTO). The clone keeps the
	// summary's theme-aware inline colours so the on-screen preview follows the
	// active theme; the @media print block recolours it for paper only.
	preview.appendChild(sourceBody.cloneNode(true));

	// Scoped stylesheet: the on-screen preview keeps the theme colours (no screen
	// override), and a transient @media print block forces readable black-on-white
	// and hides everything except the preview so only the summary lands on the page
	// / saved PDF — regardless of the active light/dark theme.
	const printStyle = doc.createElement('style');
	printStyle.textContent = [
		'@media print{',
		'  body>*:not(.ciyex-summary-print-backdrop){display:none !important;}',
		'  .ciyex-summary-print-backdrop{position:static !important;background:#fff !important;display:block !important;inset:auto !important;}',
		'  .ciyex-summary-print-sheet{box-shadow:none !important;border-radius:0 !important;width:100% !important;max-height:none !important;background:#fff !important;color:#222 !important;}',
		'  .ciyex-summary-print-toolbar{display:none !important;}',
		'  .ciyex-summary-print-preview{overflow:visible !important;padding:0 !important;background:#fff !important;}',
		'  .ciyex-summary-print-preview, .ciyex-summary-print-preview *{background-color:transparent !important;color:#222 !important;border-color:#d8d8d8 !important;box-shadow:none !important;}',
		'  @page{margin:14mm;}',
		'}',
	].join('');
	doc.head.appendChild(printStyle);

	const dismiss = () => {
		try { doc.body.removeChild(backdrop); } catch { /* ignore */ }
		try { doc.head.removeChild(printStyle); } catch { /* ignore */ }
	};
	closePrintBtn.addEventListener('click', dismiss);
	backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { dismiss(); } });
	// `document.title` becomes the default filename in the OS "Save as PDF" dialog,
	// so name it after this encounter for a sensible, per-encounter PDF file name.
	doPrintBtn.addEventListener('click', () => {
		const prevTitle = doc.title;
		doc.title = `encounter-${encounterId}-summary`;
		const win = DOM.getActiveWindow();
		win.print();
		doc.title = prevTitle;
	});
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
async function loadVisitSummary(deps: IVisitSummaryDeps, patientId: string, encounterId: string, body: HTMLElement, loading: HTMLElement): Promise<boolean> {
	try {
		const [summaryData, formComp] = await Promise.all([
			deps.apiService.fetch(`/api/encounters/${patientId}/${encounterId}/summary`)
				.then(async r => (r.ok ? await r.json() : null))
				.then(j => (j?.success ? (j.data ?? null) : (j?.data ?? j ?? null)))
				.catch(() => null),
			loadEncounterFormComposition(deps, patientId, encounterId).catch(() => null),
		]);
		loading.remove();

		// Prefer the encounter-form Composition for the clinical sections — it's
		// the source of truth for what the provider actually entered.
		const renderedForm = formComp ? renderEncounterFormSections(deps, body, formComp, summaryData) : false;

		if (!renderedForm) {
			// No form Composition yet — fall back to the /summary DTO rendering.
			if (!summaryData) {
				const errMsg = DOM.append(body, DOM.$('div'));
				errMsg.textContent = 'Unable to load encounter summary.';
				errMsg.style.cssText = `font-size:13px;color:${summaryColors(deps.themeService).error};`;
				return false;
			}
			renderVisitSummary(deps, body, summaryData as VisitSummaryDTO);
		}
		return true;
	} catch (err) {
		loading.textContent = `Failed to load encounter summary: ${String(err)}`;
		loading.style.color = summaryColors(deps.themeService).error;
		return false;
	}
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

/** Section groups for the encounter-form Composition, keyed by the field-name
 *  prefix the form uses (cc_*, hpi_*, vitals_*, …). Mirrors the encounter form's
 *  own section order so the summary reads top-to-bottom like the chart. */
const FORM_SECTION_GROUPS: Array<{ prefix: string; title: string }> = [
	{ prefix: 'cc', title: 'Chief Complaint' },
	{ prefix: 'hpi', title: 'History of Present Illness' },
	{ prefix: 'ros', title: 'Review of Systems' },
	{ prefix: 'vitals', title: 'Vitals' },
	{ prefix: 'pe', title: 'Physical Exam' },
	{ prefix: 'pmh', title: 'Past Medical / Surgical History' },
	{ prefix: 'fh', title: 'Family History' },
	{ prefix: 'sh', title: 'Social History' },
	{ prefix: 'assessment', title: 'Assessment & Diagnosis' },
	{ prefix: 'plan', title: 'Plan' },
	{ prefix: 'provider', title: 'Provider Notes' },
	{ prefix: 'procedures', title: 'Procedures & Coding' },
];

/** Default "normal" Physical Exam text per system, mirroring
 *  EncounterFormEditor.PE_SYSTEMS. The exam grid pre-fills every system with
 *  these defaults, so an untouched Physical Exam saves the full normal template.
 *  The Visit Summary uses this map to hide untouched systems and show only the
 *  findings the provider actually entered. Keyed by the sanitized system key
 *  (`system.toLowerCase().replace(/[^a-z]/g,'_')`). */
const PE_DEFAULT_NORMALS: Record<string, string> = {
	general_appearance: 'Well-appearing, in no acute distress',
	heent: 'Normocephalic, PERRL, TMs clear, oropharynx normal',
	neck: 'Supple, no lymphadenopathy, no thyromegaly',
	chest_lungs: 'Clear to auscultation bilaterally, no wheezes/rhonchi/rales',
	cardiovascular: 'RRR, no murmurs/gallops/rubs, pulses intact',
	abdomen: 'Soft, non-tender, non-distended, BS active',
	extremities: 'No edema, no cyanosis, full ROM',
	neurological: 'Alert, oriented x4, CN II-XII intact, sensation normal',
	skin: 'Warm, dry, intact, no rashes or lesions',
	psychiatric: 'Appropriate mood and affect, cooperative',
};

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
	const metaCard = DOM.append(body, DOM.$('div'));
	metaCard.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};padding:18px;margin-bottom:14px;`;
	const cardTitle = DOM.append(metaCard, DOM.$('div'));
	cardTitle.textContent = 'Encounter Summary';
	cardTitle.style.cssText = `font-size:16px;font-weight:700;color:${col.link};border-bottom:2px solid ${col.border};padding-bottom:8px;margin-bottom:14px;`;
	const grid = DOM.append(metaCard, DOM.$('div'));
	grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;';
	const metaFields: Array<[string, string | undefined]> = [
		['Visit Category', meta.visitCategory], ['Type', meta.type], ['Facility', meta.facility],
		['Date of Service', meta.dateOfService], ['Reason for Visit', meta.reasonForVisit],
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
					const joined = [code, desc].filter(Boolean).join(' - ');
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
	let renderedAny = false;

	for (const grp of FORM_SECTION_GROUPS) {
		// Fields whose key is exactly the prefix or starts with `${prefix}_`.
		const keys = allKeys.filter(k => k === grp.prefix || k.startsWith(grp.prefix + '_'));
		const rows: Array<[string, string]> = [];
		for (const k of keys) {
			// Physical Exam: show ONLY what the provider actually entered. The exam
			// grid defaults every system to its normal template, so untouched
			// encounters otherwise dump the whole normal exam. Skip the per-system
			// "Normal" checkbox scaffolding and any system left at its default text.
			if (grp.prefix === 'pe') {
				if (/_normal$/.test(k)) { usedKeys.add(k); continue; }
				const sys = k.startsWith('pe_') ? k.slice(3) : k;
				const def = PE_DEFAULT_NORMALS[sys];
				const raw = comp[k];
				if (def && typeof raw === 'string' && raw.trim().toLowerCase() === def.toLowerCase()) { usedKeys.add(k); continue; }
			}
			const v = fmtValue(k, comp[k]);
			if (v) { rows.push([humanizeFieldKey(k, grp.prefix), v]); usedKeys.add(k); }
		}
		if (!rows.length) { continue; }
		renderedAny = true;
		const card = DOM.append(body, DOM.$('div'));
		card.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};padding:16px;margin-bottom:14px;`;
		const t = DOM.append(card, DOM.$('div'));
		t.textContent = grp.title;
		t.style.cssText = `font-weight:600;color:${col.fg};margin-bottom:10px;font-size:14px;`;
		// Chief complaint is a single free-text value — show it without a label.
		if (grp.prefix === 'cc' && rows.length === 1) {
			const p = DOM.append(card, DOM.$('div'));
			p.textContent = rows[0][1];
			p.style.cssText = `font-size:13px;color:${col.fg};white-space:pre-wrap;`;
		} else {
			for (const [label, value] of rows) {
				const row = DOM.append(card, DOM.$('div'));
				row.style.cssText = 'font-size:13px;margin-bottom:4px;';
				const b = DOM.append(row, DOM.$('span'));
				b.textContent = `${label}: `;
				b.style.cssText = `font-weight:600;color:${col.desc};`;
				const val = DOM.append(row, DOM.$('span'));
				val.textContent = value;
				val.style.cssText = `color:${col.fg};white-space:pre-wrap;`;
			}
		}
	}

	if (!renderedAny) {
		const none = DOM.append(body, DOM.$('div'));
		none.textContent = 'No clinical sections recorded for this encounter yet.';
		none.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};padding:18px;text-align:center;font-size:13px;color:${col.desc};`;
	}
	return true;
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
