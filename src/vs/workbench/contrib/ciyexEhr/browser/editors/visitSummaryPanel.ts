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
	/** Rendering-provider name for this encounter. */
	providerName?: string;
	/** The encounter's own id (shown in the summary header). */
	encounterId?: string;
	/** Patient's formatted date of birth. */
	patientDateOfBirth?: string;
	/** Patient's "{age} · {gender}" summary. */
	patientAgeGender?: string;
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
function expandEncounterType(raw: string | undefined): string | undefined {
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

	// A print-only stylesheet (it lives entirely inside `@media print`, so it has
	// NO on-screen effect) that isolates the summary body for both actions —
	// "Download PDF" (the native host renders the window to a PDF) and "Print"
	// (the OS print dialog). It hides the workbench, the panel header/footer and
	// the backdrop dimmer so only the summary content — forced to legible
	// black-on-white — lands on the page / in the saved file, regardless of the
	// active light/dark theme.
	const printStyle = doc.createElement('style');
	printStyle.textContent = [
		'@media print{',
		'  body>*:not(.ciyex-summary-backdrop){display:none !important;}',
		'  .ciyex-summary-backdrop{position:static !important;background:#fff !important;display:block !important;inset:auto !important;}',
		'  .ciyex-summary-sheet{box-shadow:none !important;border-radius:0 !important;width:100% !important;height:auto !important;max-height:none !important;background:#fff !important;color:#222 !important;overflow:visible !important;}',
		'  .ciyex-summary-header, .ciyex-summary-footer{display:none !important;}',
		'  .ciyex-summary-body{overflow:visible !important;height:auto !important;background:#fff !important;}',
		'  .ciyex-summary-body, .ciyex-summary-body *{background-color:transparent !important;color:#222 !important;border-color:#d8d8d8 !important;box-shadow:none !important;}',
		'  @page{margin:14mm;}',
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
				deps.notificationService.notify({ severity: Severity.Error, message: 'Could not generate the visit summary PDF. Please try again.' });
				return;
			}
			deps.notificationService.notify({ severity: Severity.Info, message: `Visit summary saved to ${savedPath}` });
		} catch (err) {
			deps.notificationService.notify({ severity: Severity.Error, message: `Could not save the visit summary PDF: ${err instanceof Error ? err.message : String(err)}` });
		} finally {
			pdfBtn.disabled = false;
		}
	};

	// "Print" ONLY hands the summary to the OS Print dialog. `document.title`
	// becomes the default filename if the user picks "Save as PDF" there.
	const printSummary = () => {
		if (!summaryLoaded) {
			deps.notificationService.notify({ severity: Severity.Info, message: 'The visit summary is still loading. Please try again in a moment.' });
			return;
		}
		const prevTitle = doc.title;
		doc.title = `encounter-${encounterId}-summary`;
		DOM.getActiveWindow().print();
		doc.title = prevTitle;
	};

	pdfBtn.addEventListener('click', () => void downloadPdf());
	printBtn.addEventListener('click', () => printSummary());

	void loadVisitSummary(deps, patientId, encounterId, body, loading, facilityHint).then(ok => { summaryLoaded = ok; });
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
async function loadVisitSummary(deps: IVisitSummaryDeps, patientId: string, encounterId: string, body: HTMLElement, loading: HTMLElement, facilityHint?: string): Promise<boolean> {
	try {
		const [summaryData, formComp, encResource, patientResource] = await Promise.all([
			deps.apiService.fetch(`/api/encounters/${patientId}/${encounterId}/summary`)
				.then(async r => (r.ok ? await r.json() : null))
				.then(j => (j?.success ? (j.data ?? null) : (j?.data ?? j ?? null)))
				.catch(() => null),
			loadEncounterFormComposition(deps, patientId, encounterId).catch(() => null),
			deps.apiService.fetch(`/api/fhir-resource/encounters/${encounterId}`)
				.then(async r => (r.ok ? (((await r.json())?.data ?? null) as Record<string, unknown> | null) : null))
				.catch(() => null),
			// Patient demographics (DOB / gender / age) for the summary header.
			deps.apiService.fetch(`/api/patients/${patientId}`)
				.then(async r => (r.ok ? await r.json() : null))
				.then(j => ((j?.data ?? j ?? null) as Record<string, unknown> | null))
				.catch(() => null),
		]);
		// Always render the meta header from a real summary object with a `meta`
		// block — even when the /summary endpoint returned nothing, the form
		// Composition path still shows the enriched Encounter Summary header.
		const summary = (summaryData && typeof summaryData === 'object' ? summaryData : {}) as VisitSummaryDTO;
		if (!summary.meta) { summary.meta = {}; }
		await sanitizeSummaryMeta(deps, summary, encResource, facilityHint);
		await enrichSummaryMeta(deps, summary.meta, encounterId, encResource, patientResource, summary);
		loading.remove();

		// The encounter-form Composition endpoint is PATIENT-scoped. Different
		// surfaces can hand this panel different ids for the same person (the
		// appointment's patient id vs the Encounter subject's id), so when the
		// lookup under the caller's id finds nothing, retry under the patient id
		// the Encounter resource itself points at — otherwise data charted from
		// the appointment drawer never shows in a summary opened elsewhere.
		let comp = formComp;
		if (!comp && encResource) {
			const encPatient = String(encResource.patientId ?? encResource.patientRef ?? '').replace(/^Patient\//i, '').trim();
			if (encPatient && encPatient !== patientId) {
				comp = await loadEncounterFormComposition(deps, encPatient, encounterId).catch(() => null);
			}
		}

		// Prefer the encounter-form Composition for the clinical sections — it's
		// the source of truth for what the provider actually entered.
		const renderedForm = comp ? renderEncounterFormSections(deps, body, comp, summary) : false;

		if (!renderedForm) {
			// No form Composition yet — fall back to the /summary DTO rendering.
			if (!summaryData) {
				const errMsg = DOM.append(body, DOM.$('div'));
				errMsg.textContent = 'Unable to load encounter summary.';
				errMsg.style.cssText = `font-size:13px;color:${summaryColors(deps.themeService).error};`;
				return false;
			}
			renderVisitSummary(deps, body, summary);
		}
		return true;
	} catch (err) {
		loading.textContent = `Failed to load encounter summary: ${String(err)}`;
		loading.style.color = summaryColors(deps.themeService).error;
		return false;
	}
}

/** Adds the provider, encounter-id and patient-demographic fields to the meta
 *  header (QA: the Encounter Summary must show date of service, provider name,
 *  encounter id, DOB and age/gender). Only fills fields that are still empty so
 *  a value already provided by the /summary DTO wins. */
async function enrichSummaryMeta(deps: IVisitSummaryDeps, meta: VisitSummaryMeta, encounterId: string, enc: Record<string, unknown> | null, patient: Record<string, unknown> | null, summary: VisitSummaryDTO): Promise<void> {
	const asText = (v: unknown): string => {
		if (!v) { return ''; }
		if (typeof v === 'string') { return v.trim(); }
		if (Array.isArray(v)) { return v.map(asText).filter(Boolean)[0] || ''; }
		if (typeof v === 'object') { const o = v as Record<string, unknown>; return String(o.display || o.name || o.providerName || o.text || '').trim(); }
		return '';
	};
	const fmtDate = (d: unknown): string => {
		if (!d) { return ''; }
		try { return new Date(String(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(d); }
	};

	// Encounter id — prefer the resource's own id, fall back to the caller's.
	if (!meta.encounterId) {
		meta.encounterId = String((enc && (enc.id ?? enc.encounterId ?? enc.fhirId)) || encounterId || '').trim() || undefined;
	}
	// Provider — the first assigned provider, else the encounter's practitioner.
	if (!meta.providerName) {
		const prov = summary.assignedProviders?.find(p => p.providerName || p.name);
		meta.providerName = (prov?.providerName || prov?.name
			|| asText(enc?.practitionerName) || asText(enc?.providerName) || asText(enc?.practitioner) || asText(enc?.provider)) || undefined;
	}
	// The Encounter resource often carries only a bare `Practitioner/{id}`
	// reference (no display name), which reads as an id in the header. Resolve it
	// to the provider's name via the org's /api/providers list so the summary
	// shows a real name (QA: "provider name will be added").
	if (meta.providerName) {
		const trimmed = meta.providerName.trim();
		const refMatch = /^Practitioner\/(\d+)$/i.exec(trimmed);
		const providerId = refMatch ? refMatch[1] : (/^\d+$/.test(trimmed) ? trimmed : '');
		if (providerId) {
			try {
				const r = await deps.apiService.fetch('/api/providers');
				if (r.ok) {
					const j = await r.json().catch(() => null);
					const list = (j?.data?.content ?? j?.data ?? j ?? []) as Array<Record<string, unknown>>;
					const hit = Array.isArray(list) ? list.find(p => String(p.id) === String(providerId)) : undefined;
					if (hit) {
						const nm = [hit.firstName, hit.lastName].filter(Boolean).map(String).join(' ').trim() || asText(hit.name) || asText(hit.displayName) || asText(hit.providerName);
						if (nm) { meta.providerName = nm; }
					}
				}
			} catch { /* keep the reference when the lookup fails */ }
		}
	}
	// Date of service — backfill from the encounter when /summary omitted it.
	if (!meta.dateOfService && enc) {
		meta.dateOfService = fmtDate(enc.periodStart ?? enc.start ?? enc.date ?? enc.encounterDate ?? enc.startDate) || undefined;
	}
	// Patient demographics — DOB and a combined "{age} · {Gender}".
	if (patient) {
		const dobRaw = patient.dateOfBirth ?? patient.birthDate ?? patient.dob ?? '';
		const gender = String(patient.gender ?? patient.sex ?? '').trim();
		if (dobRaw && !meta.patientDateOfBirth) { meta.patientDateOfBirth = fmtDate(dobRaw) || undefined; }
		if (!meta.patientAgeGender) {
			let age = '';
			if (dobRaw) {
				try {
					const d = new Date(String(dobRaw));
					const now = new Date();
					let y = now.getFullYear() - d.getFullYear();
					const m = now.getMonth() - d.getMonth();
					if (m < 0 || (m === 0 && now.getDate() < d.getDate())) { y--; }
					if (y >= 0 && y < 200) { age = `${y} yrs`; }
				} catch { /* age stays empty */ }
			}
			const g = gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : '';
			meta.patientAgeGender = [age, g].filter(Boolean).join(' · ') || undefined;
		}
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
function summarySectionCard(body: HTMLElement, col: SummaryColors, title: string, icon?: string): HTMLElement {
	const card = DOM.append(body, DOM.$('div'));
	card.style.cssText = `border:1px solid ${col.border};border-radius:8px;background:${col.widgetBg};margin-bottom:12px;overflow:hidden;`;
	const head = DOM.append(card, DOM.$('div'));
	head.style.cssText = `display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid ${col.border};border-left:3px solid ${col.link};background:rgba(128,128,128,0.06);`;
	if (icon) {
		const ic = DOM.append(head, DOM.$('span'));
		ic.textContent = icon;
		ic.style.cssText = 'font-size:13px;line-height:1;';
	}
	const t = DOM.append(head, DOM.$('span'));
	t.textContent = title;
	t.style.cssText = `font-size:13px;font-weight:700;color:${col.fg};letter-spacing:0.02em;`;
	return DOM.append(card, DOM.$('div'));
}

/** One aligned label / value row inside a section card. Rows zebra-stripe so
 *  long sections stay scannable. */
function summaryKvRow(table: HTMLElement, col: SummaryColors, label: string, value: string): void {
	const idx = table.childElementCount;
	const row = DOM.append(table, DOM.$('div'));
	row.style.cssText = `display:grid;grid-template-columns:190px 1fr;gap:12px;padding:7px 14px;align-items:start;${idx % 2 === 0 ? 'background:rgba(128,128,128,0.045);' : ''}`;
	const l = DOM.append(row, DOM.$('span'));
	l.textContent = label;
	l.style.cssText = `font-size:12px;font-weight:600;color:${col.desc};padding-top:1px;`;
	const v = DOM.append(row, DOM.$('span'));
	v.textContent = value;
	v.style.cssText = `font-size:13px;color:${col.fg};white-space:pre-wrap;word-break:break-word;`;
}

/** Full-width free-text row (used for single-value sections like the chief
 *  complaint, where a label column would only repeat the section title). */
function summaryTextRow(table: HTMLElement, col: SummaryColors, text: string): void {
	const row = DOM.append(table, DOM.$('div'));
	row.textContent = text;
	row.style.cssText = `padding:9px 14px;font-size:13px;color:${col.fg};white-space:pre-wrap;word-break:break-word;`;
}

/** The "Encounter Summary" meta header card, shared by both render paths. */
function renderSummaryMetaCard(body: HTMLElement, col: SummaryColors, meta: VisitSummaryMeta): void {
	// allow-any-unicode-next-line
	const table = summarySectionCard(body, col, 'Encounter Summary', '📄');
	const metaFields: Array<[string, string | undefined]> = [
		['Visit Category', meta.visitCategory],
		['Type', meta.type],
		['Date of Service', meta.dateOfService],
		['Provider', meta.providerName],
		['Encounter ID', meta.encounterId],
		['Date of Birth', meta.patientDateOfBirth],
		['Age / Gender', meta.patientAgeGender],
		['Facility', meta.facility],
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
		const table = summarySectionCard(body, col, grp.title, grp.icon);
		// Chief complaint is a single free-text value — show it without a label.
		if (grp.prefix === 'cc' && rows.length === 1) {
			summaryTextRow(table, col, rows[0][1]);
		} else {
			for (const [label, value] of rows) {
				summaryKvRow(table, col, label, value);
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
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;margin:8px 14px;overflow:hidden;`;
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
				head.style.cssText = `color:${col.fg};font-weight:600;padding:6px 14px 0;`;
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
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;margin:8px 14px;overflow:hidden;`;
			// One measurement per row \u2014 QA wants the summary data row-wise.
			if (v.bpSystolic && v.bpDiastolic) { line(block, 'BP', `${v.bpSystolic}/${v.bpDiastolic} mmHg`); }
			if (v.pulse) { line(block, 'Pulse', `${v.pulse} bpm`); }
			if (v.temperatureC) { line(block, 'Temp', `${v.temperatureC} \u00B0C`); }
			if (v.temperatureF) { line(block, 'Temp', `${v.temperatureF} \u00B0F`); }
			if (v.respiration) { line(block, 'Respiration', `${v.respiration} /min`); }
			if (v.oxygenSaturation) { line(block, 'O2 Sat', `${v.oxygenSaturation}%`); }
			if (v.weightKg) { line(block, 'Weight', `${v.weightKg} kg`); }
			if (v.weightLbs) { line(block, 'Weight', `${v.weightLbs} lbs`); }
			if (v.heightCm) { line(block, 'Height', `${v.heightCm} cm`); }
			if (v.heightIn) { line(block, 'Height', `${v.heightIn} in`); }
			if (v.bmi) { line(block, 'BMI', v.bmi); }
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
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;margin:8px 14px;overflow:hidden;`;
			if (p.summary) { line(block, 'Summary', p.summary); }
			for (const s of p.sections || []) {
				const head = DOM.append(block, DOM.$('div'));
				head.style.cssText = `color:${col.fg};font-weight:600;padding:6px 14px 0;`;
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
			block.style.cssText = `border:1px solid ${col.border};border-radius:6px;margin:8px 14px;overflow:hidden;`;
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
