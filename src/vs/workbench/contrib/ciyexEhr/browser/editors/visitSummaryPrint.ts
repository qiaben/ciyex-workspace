/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';

/**
 * Paginated print document + in-app print preview for the Visit Summary.
 *
 * Chromium/Electron cannot show a print preview of the app itself — the OS
 * print dialog reports "This app doesn't support print preview" — so the
 * summary is laid out here into explicit, paper-sized page elements that are
 * both what the user previews and what gets rendered to paper / PDF. Owning the
 * pagination (instead of letting the printer engine flow the content) is what
 * makes the two QA asks possible at all:
 *
 *  - every page carries its own complete border (each page element paints its
 *    own frame, so no border can be "half painted" by a box that fragments), and
 *  - every page carries a centred "Page X of Y" INSIDE that frame (the printer
 *    engine can only stamp page numbers into the paper margin, outside it).
 */

/** Letter paper at 96dpi, in CSS pixels — the unit print layout uses. */
const PAGE_WIDTH_PX = 816;   // 8.5in
const PAGE_HEIGHT_PX = 1056; // 11in
/** Shaved off the page height so a rounding difference between our layout and
 *  the print engine's sheet can never spill a page onto a blank extra sheet. */
const PAGE_BLEED_PX = 4;
/** White paper margin outside the page frame. */
const PAGE_MARGIN_PX = 38;
/** Padding between the page frame and its content. */
const FRAME_PADDING_PX = 22;
/** Reserved strip at the bottom of the frame for the page number. */
const FOOTER_HEIGHT_PX = 26;
/** Width available to the summary content inside the frame. */
const CONTENT_WIDTH_PX = PAGE_WIDTH_PX - (2 * PAGE_MARGIN_PX) - 2 /* frame border */ - (2 * FRAME_PADDING_PX);
/** Height available to the summary content, before the letterhead is subtracted. */
const PAGE_CONTENT_HEIGHT_PX = PAGE_HEIGHT_PX - PAGE_BLEED_PX - (2 * PAGE_MARGIN_PX) - 2 - (2 * FRAME_PADDING_PX) - FOOTER_HEIGHT_PX;
/** A section is pushed to the next page rather than started in a stub of space. */
const MIN_SPLIT_REMAINDER_PX = 120;

/** The document is mounted on `document.body`, which sits outside the workbench
 *  element that scopes the `--vscode-*` variables, so no theme variable resolves
 *  here — the font stack has to be spelled out (the measuring sandbox uses the
 *  same one, otherwise the measured heights would not match the printed ones). */
const PRINT_FONT_STACK = '"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif';

const PRINT_DOC_CSS = [
	// The real document lives off-screen: it must be laid out (so print can pick
	// it up) but must never be visible in the workbench.
	`.ciyex-print-doc{position:fixed;left:-10000px;top:0;width:${PAGE_WIDTH_PX}px;background:#fff;color:#222;font-family:${PRINT_FONT_STACK};z-index:-1;}`,
	`.ciyex-print-measure{position:fixed;left:-10000px;top:0;width:${CONTENT_WIDTH_PX}px;visibility:hidden;background:#fff;color:#222;font-family:${PRINT_FONT_STACK};}`,
	`.ciyex-print-page{box-sizing:border-box;width:${PAGE_WIDTH_PX}px;height:${PAGE_HEIGHT_PX - PAGE_BLEED_PX}px;padding:${PAGE_MARGIN_PX}px;background:#fff;color:#222;font-family:${PRINT_FONT_STACK};overflow:hidden;}`,
	'.ciyex-print-frame{box-sizing:border-box;height:100%;border:1px solid #9aa0a6;padding:' + FRAME_PADDING_PX + 'px;display:flex;flex-direction:column;}',
	'.ciyex-print-head{flex:0 0 auto;margin-bottom:10px;}',
	'.ciyex-print-body{flex:1 1 auto;overflow:hidden;}',
	`.ciyex-print-foot{flex:0 0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:end;height:${FOOTER_HEIGHT_PX}px;font-size:9px;}`,
	'.ciyex-print-stamp{grid-column:1;text-align:left;color:#777;}',
	// The page number sits in the centre column, so it is centred on the page
	// itself and not merely on whatever text shares its row.
	'.ciyex-print-pageno{grid-column:2;text-align:center;font-size:10px;font-weight:600;color:#333;}',
	// The cloned summary carries the panel's THEME colours inline (light text on
	// a dark background). Force print colours on everything inside a page — the
	// page/frame themselves are excluded because this only matches descendants.
	'.ciyex-print-page *,.ciyex-print-measure *{background-color:transparent !important;color:#222 !important;border-color:#d8d8d8 !important;box-shadow:none !important;}',
	'.ciyex-print-page .ciyex-print-frame{border-color:#9aa0a6 !important;}',
	'.ciyex-print-page .ciyex-print-stamp{color:#777 !important;}',
	'.ciyex-print-page .ciyex-print-pageno{color:#333 !important;}',
	// The letterhead rules and the signature line are deliberately bold black.
	'.ciyex-print-page .vs-hdr-rule,.ciyex-print-measure .vs-hdr-rule{border-bottom-color:#222 !important;}',
	'.ciyex-print-page .vs-sig-rule,.ciyex-print-measure .vs-sig-rule{border-color:#222 !important;}',
	'@media print{',
	'  html,body{background:#fff !important;}',
	// Everything else in the window — workbench, summary slide-over, preview
	// dialog — is hidden; only the paginated document reaches the paper.
	'  body>*:not(.ciyex-print-doc){display:none !important;}',
	'  .ciyex-print-doc{position:static !important;left:auto !important;top:auto !important;z-index:auto !important;}',
	'  .ciyex-print-page{break-after:page;page-break-after:always;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
	'  .ciyex-print-page:last-child{break-after:auto;page-break-after:auto;}',
	// Zero page margins: each page element already contains its own paper
	// margin, frame and page number, so the print engine must not add its own.
	'  @page{size:8.5in 11in;margin:0;}',
	'}',
].join('');

/** A built, mounted print document. Dispose removes it (and its stylesheet)
 *  from the window. */
export interface IPrintDocument extends IDisposable {
	/** The mounted `.ciyex-print-doc` element (one `.ciyex-print-page` per sheet). */
	readonly element: HTMLElement;
	readonly pageCount: number;
}

/** Print date/time stamp shown at the bottom-left of every page. */
function printStamp(): string {
	const d = new Date();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	let hours = d.getHours();
	const suffix = hours >= 12 ? 'PM' : 'AM';
	hours = hours % 12 || 12;
	return `Printed ${mm}/${dd}/${d.getFullYear()} ${hours}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/** Measures detached clones at the printed content width, using the printed
 *  font — the pagination is only as good as these numbers. */
interface IMeasurer {
	(element: HTMLElement): number;
}

/** One page-sized piece of a section that was too tall to fit a page whole. */
interface IBlockFragment {
	readonly element: HTMLElement;
	readonly height: number;
}

/** Splits an over-tall section row-wise so it continues across pages instead of
 *  being clipped. The section's heading is repeated (marked "cont.") on each
 *  continuation. Sections that are not heading + rows are returned unsplit. */
function splitBlock(block: HTMLElement, firstAvailable: number, fullAvailable: number, measure: IMeasurer): IBlockFragment[] {
	const heading = block.children[0] as HTMLElement | undefined;
	const rowsHost = block.children[1] as HTMLElement | undefined;
	if (block.children.length !== 2 || !heading || !rowsHost || rowsHost.children.length < 2) {
		return [{ element: block, height: measure(block.cloneNode(true) as HTMLElement) }];
	}

	const rows = Array.from(rowsHost.children) as HTMLElement[];
	const headingHeight = measure(heading.cloneNode(true) as HTMLElement);
	const rowHeights = rows.map(row => measure(row.cloneNode(true) as HTMLElement));

	const fragments: IBlockFragment[] = [];
	let limit = Math.max(firstAvailable, MIN_SPLIT_REMAINDER_PX);
	let element = block.cloneNode(false) as HTMLElement;
	let host = rowsHost.cloneNode(false) as HTMLElement;
	let used = headingHeight;
	element.appendChild(heading.cloneNode(true));
	element.appendChild(host);

	const startFragment = (): void => {
		fragments.push({ element, height: used });
		limit = fullAvailable;
		element = block.cloneNode(false) as HTMLElement;
		host = rowsHost.cloneNode(false) as HTMLElement;
		const continued = heading.cloneNode(true) as HTMLElement;
		const title = continued.lastElementChild;
		if (title?.textContent) { title.textContent = `${title.textContent} (cont.)`; }
		element.appendChild(continued);
		element.appendChild(host);
		used = headingHeight;
	};

	rows.forEach((row, index) => {
		if (host.children.length && used + rowHeights[index] > limit) { startFragment(); }
		host.appendChild(row.cloneNode(true));
		used += rowHeights[index];
	});
	fragments.push({ element, height: used });
	return fragments;
}

/** Packs the summary's sections into pages, keeping every section whole unless
 *  it is taller than a page on its own (then it continues onto the next). */
function paginate(blocks: HTMLElement[], available: number, measure: IMeasurer): HTMLElement[][] {
	const pages: HTMLElement[][] = [];
	let current: HTMLElement[] = [];
	let used = 0;
	const flush = (): void => {
		if (current.length) { pages.push(current); }
		current = [];
		used = 0;
	};

	for (const block of blocks) {
		const clone = block.cloneNode(true) as HTMLElement;
		const height = measure(clone);
		if (height <= available - used) {
			current.push(clone);
			used += height;
		} else if (height <= available) {
			flush();
			current.push(clone);
			used = height;
		} else {
			if (available - used < MIN_SPLIT_REMAINDER_PX) { flush(); }
			const fragments = splitBlock(clone, available - used, available, measure);
			fragments.forEach((fragment, index) => {
				if (index > 0 || fragment.height > available - used) { flush(); }
				current.push(fragment.element);
				used += fragment.height;
			});
		}
	}
	flush();
	if (!pages.length) { pages.push([]); }
	return pages;
}

/**
 * Lays the visit summary out into paper-sized pages and mounts the result
 * off-screen, ready for `window.print()` or the main process' `printToPDF`.
 *
 * `letterhead` is the (screen-hidden) practice/patient banner — it is cloned
 * onto every page — and `content` holds the rendered `.vs-card` sections.
 */
export function buildVisitSummaryPrintDocument(letterhead: HTMLElement, content: HTMLElement): IPrintDocument {
	const targetWindow = DOM.getActiveWindow();

	const style = targetWindow.document.createElement('style');
	style.textContent = PRINT_DOC_CSS;
	targetWindow.document.head.appendChild(style);

	const sandbox = DOM.append(targetWindow.document.body, DOM.$('div.ciyex-print-measure'));
	const measure: IMeasurer = element => {
		sandbox.appendChild(element);
		const height = element.getBoundingClientRect().height;
		const marginBottom = parseFloat(targetWindow.getComputedStyle(element).marginBottom || '0') || 0;
		sandbox.removeChild(element);
		return height + marginBottom;
	};

	// The letterhead lives in a table cell (the panel's repeating-header trick);
	// re-host its children in a plain div so it measures and lays out the same
	// on every page.
	const letterheadTemplate = DOM.$('div.ciyex-print-head');
	for (const child of Array.from(letterhead.children)) {
		letterheadTemplate.appendChild(child.cloneNode(true));
	}
	const letterheadHeight = measure(letterheadTemplate.cloneNode(true) as HTMLElement);
	const available = Math.max(PAGE_CONTENT_HEIGHT_PX - letterheadHeight, MIN_SPLIT_REMAINDER_PX);

	const pages = paginate(Array.from(content.children) as HTMLElement[], available, measure);

	const element = DOM.$('div.ciyex-print-doc');
	const stamp = printStamp();
	pages.forEach((blocks, index) => {
		const page = DOM.append(element, DOM.$('div.ciyex-print-page'));
		const frame = DOM.append(page, DOM.$('div.ciyex-print-frame'));
		frame.appendChild(letterheadTemplate.cloneNode(true));
		const pageBody = DOM.append(frame, DOM.$('div.ciyex-print-body'));
		for (const block of blocks) { pageBody.appendChild(block); }
		const foot = DOM.append(frame, DOM.$('div.ciyex-print-foot'));
		DOM.append(foot, DOM.$('span.ciyex-print-stamp')).textContent = stamp;
		DOM.append(foot, DOM.$('span.ciyex-print-pageno')).textContent = `Page ${index + 1} of ${pages.length}`;
	});
	targetWindow.document.body.appendChild(element);

	return {
		element,
		pageCount: pages.length,
		dispose: () => {
			element.remove();
			sandbox.remove();
			style.remove();
		}
	};
}

/** Theme colours the preview dialog paints itself with. It is mounted on
 *  `document.body`, outside the workbench element that scopes `--vscode-*`, so
 *  the caller resolves concrete colours for it. */
export interface IPrintPreviewTheme {
	readonly widgetBg: string;
	readonly fg: string;
	readonly border: string;
	readonly desc: string;
}

export interface IPrintPreviewOptions {
	readonly title: string;
	readonly theme: IPrintPreviewTheme;
	/** Sends the previewed document to a printer (via the OS print dialog).
	 *  Resolves `true` when it was actually printed; the preview closes then. */
	readonly onPrint: () => Promise<boolean>;
	/** Saves the previewed document as a PDF. Resolves once the save finished
	 *  (or the user cancelled); the preview closes on success. */
	readonly onDownload: () => Promise<boolean>;
	/** Called after the preview is dismissed. */
	readonly onClose?: () => void;
}

/**
 * Shows the built page document in an in-app preview dialog — the piece the OS
 * print dialog refuses to render — so the user can check every page before
 * sending it to a printer or saving it.
 *
 * Printing from here still opens the OS print dialog (only it can talk to a
 * physical printer), but by then the content has already been reviewed.
 */
export function showVisitSummaryPrintPreview(printDoc: IPrintDocument, options: IPrintPreviewOptions): void {
	const targetWindow = DOM.getActiveWindow();
	const theme = options.theme;
	const store = new DisposableStore();

	const backdrop = DOM.append(targetWindow.document.body, DOM.$('div.ciyex-print-preview-backdrop'));
	backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;';

	const dialog = DOM.append(backdrop, DOM.$('div'));
	dialog.style.cssText = `background:${theme.widgetBg};color:${theme.fg};width:min(1000px,94vw);height:min(94vh,1100px);display:flex;flex-direction:column;border:1px solid ${theme.border};border-radius:8px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,0.5);font-family:${PRINT_FONT_STACK};`;

	// --- Header: title + page count + close ---
	const header = DOM.append(dialog, DOM.$('div'));
	header.style.cssText = `display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid ${theme.border};flex-shrink:0;`;
	const title = DOM.append(header, DOM.$('span'));
	title.textContent = `Print Preview — ${options.title}`;
	title.style.cssText = `font-size:14px;font-weight:600;color:${theme.fg};flex:1;`;
	const pageCount = DOM.append(header, DOM.$('span'));
	pageCount.textContent = printDoc.pageCount === 1 ? '1 page' : `${printDoc.pageCount} pages`;
	pageCount.style.cssText = `font-size:12px;color:${theme.desc};`;
	const closeBtn = DOM.append(header, DOM.$('button.codicon.codicon-close')) as HTMLButtonElement;
	closeBtn.title = 'Close';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:transparent;color:${theme.desc};border:none;border-radius:5px;cursor:pointer;font-size:15px;`;

	// --- Paper area: the actual pages, scaled to fit the dialog ---
	const scroller = DOM.append(dialog, DOM.$('div'));
	scroller.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;background:#4a4a4a;padding:18px;display:flex;flex-direction:column;align-items:center;gap:18px;scrollbar-width:none;-ms-overflow-style:none;';

	// Each page is a clone of the real (printed) page, scaled down inside a
	// holder that reserves the scaled footprint — so the preview is pixel-exact
	// to what the printer / PDF gets, only smaller.
	const holders: Array<{ holder: HTMLElement; page: HTMLElement }> = [];
	for (const printedPage of Array.from(printDoc.element.children)) {
		const holder = DOM.append(scroller, DOM.$('div'));
		holder.style.cssText = 'flex:0 0 auto;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,0.45);overflow:hidden;';
		const page = printedPage.cloneNode(true) as HTMLElement;
		page.style.transformOrigin = 'top left';
		holder.appendChild(page);
		holders.push({ holder, page });
	}

	const applyScale = (): void => {
		const width = scroller.clientWidth - 36;
		const height = scroller.clientHeight - 36;
		if (width <= 0 || height <= 0) { return; }
		// Fit a WHOLE page in view — the point of the preview is checking pages,
		// which a page that needs scrolling to see its own footer defeats.
		const scale = Math.min(1, width / PAGE_WIDTH_PX, height / (PAGE_HEIGHT_PX - PAGE_BLEED_PX));
		for (const { holder, page } of holders) {
			holder.style.width = `${Math.floor(PAGE_WIDTH_PX * scale)}px`;
			holder.style.height = `${Math.floor((PAGE_HEIGHT_PX - PAGE_BLEED_PX) * scale)}px`;
			page.style.transform = `scale(${scale})`;
		}
	};

	// --- Footer: the actions the preview exists to gate ---
	const footer = DOM.append(dialog, DOM.$('div'));
	footer.style.cssText = `display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 16px;border-top:1px solid ${theme.border};flex-shrink:0;`;
	const hint = DOM.append(footer, DOM.$('span'));
	hint.textContent = 'Check every page before printing.';
	hint.style.cssText = `font-size:12px;color:${theme.desc};flex:1;`;
	const makeButton = (codicon: string, label: string, primary: boolean): HTMLButtonElement => {
		const btn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		btn.style.cssText = primary
			? 'display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);border:none;border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;'
			: `display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:var(--vscode-button-secondaryBackground,#3a3d41);color:var(--vscode-button-secondaryForeground,#ccc);border:1px solid ${theme.border};border-radius:5px;cursor:pointer;font-size:12px;font-weight:600;`;
		const icon = DOM.append(btn, DOM.$('span.codicon.codicon-' + codicon));
		icon.style.cssText = 'font-size:14px;';
		DOM.append(btn, DOM.$('span')).textContent = label;
		return btn;
	};
	const downloadBtn = makeButton('cloud-download', 'Download PDF', false);
	const printBtn = makeButton('printer', 'Print', true);

	const dismiss = (): void => {
		store.dispose();
		backdrop.remove();
		options.onClose?.();
	};

	store.add(DOM.addDisposableListener(closeBtn, DOM.EventType.CLICK, dismiss));
	store.add(DOM.addDisposableListener(backdrop, DOM.EventType.CLICK, e => {
		if (e.target === backdrop) { dismiss(); }
	}));
	store.add(DOM.addDisposableListener(targetWindow.document, DOM.EventType.KEY_DOWN, (e: KeyboardEvent) => {
		if (e.key === 'Escape') { dismiss(); }
	}));
	store.add(DOM.addDisposableListener(targetWindow, DOM.EventType.RESIZE, applyScale));

	// Both actions run against the mounted document, which stays in the window for
	// the whole life of the preview — so it is still there while the OS print or
	// save dialog is up.
	const runAction = (button: HTMLButtonElement, action: () => Promise<boolean>): void => {
		button.disabled = true;
		void action().then(done => {
			button.disabled = false;
			if (done) { dismiss(); }
		}, () => { button.disabled = false; });
	};
	store.add(DOM.addDisposableListener(printBtn, DOM.EventType.CLICK, () => runAction(printBtn, options.onPrint)));
	store.add(DOM.addDisposableListener(downloadBtn, DOM.EventType.CLICK, () => runAction(downloadBtn, options.onDownload)));

	applyScale();
	// The dialog is measured after layout settles, so the first paint is scaled.
	targetWindow.requestAnimationFrame(applyScale);
}
