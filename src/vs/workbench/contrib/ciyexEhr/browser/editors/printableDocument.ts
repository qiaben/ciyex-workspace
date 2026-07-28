/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../../base/browser/domSanitize.js';
import { INativeHostService } from '../../../../../platform/native/common/native.js';

/**
 * Render an arbitrary HTML fragment to a real `.pdf` file.
 *
 * A renderer-side `blob:` download anchor does NOT produce a file in the
 * `vscode-file://` workbench, so PDFs are produced the same way the visit
 * summary does it: the fragment is mounted into the active window behind a
 * print-only stylesheet that hides everything else, and the main process
 * renders the window with `printToPDF` (which pops the Save dialog).
 *
 * The mount is invisible on screen — it lives in a zero-size, clipped container
 * — so nothing flashes while the PDF is captured.
 */
export async function savePrintableAsPdf(nativeHostService: INativeHostService, fileName: string, bodyHtml: string, extraPrintCss = ''): Promise<string | undefined> {
	const doc = DOM.getActiveWindow().document;

	const mount = doc.createElement('div');
	mount.className = 'ciyex-printable-doc';
	// Off-screen and zero-height on screen; the print stylesheet below restores it.
	mount.style.cssText = 'position:fixed;left:-10000px;top:0;width:190mm;overflow:hidden;background:#fff;color:#222;';
	// VS Code's Trusted Types policy rejects BOTH direct `innerHTML` assignment
	// and `DOMParser.parseFromString`, so the markup goes through the workbench
	// sanitizer. `class` and `colspan` are not on its default attribute
	// allow-list and the print stylesheet is entirely class-driven, so they are
	// augmented in — without them every rule below silently stops matching.
	safeSetInnerHtml(mount, bodyHtml, {
		allowedAttributes: { augment: ['class', 'colspan', 'rowspan'] },
	});
	doc.body.appendChild(mount);

	const style = doc.createElement('style');
	style.textContent = [
		'@media print{',
		'  body>*:not(.ciyex-printable-doc){display:none !important;}',
		'  .ciyex-printable-doc{position:static !important;left:auto !important;width:100% !important;overflow:visible !important;background:#fff !important;color:#222 !important;}',
		'  .ciyex-printable-doc *{background-color:transparent !important;color:#222 !important;box-shadow:none !important;}',
		'  .ciyex-printable-doc h1{font-size:18px;margin:0 0 4px;}',
		'  .ciyex-printable-doc h2{font-size:13px;margin:0 0 4px;}',
		'  .ciyex-printable-doc .meta{font-size:11px;color:#555 !important;margin-bottom:10px;}',
		'  .ciyex-printable-doc table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:6px;}',
		'  .ciyex-printable-doc th,.ciyex-printable-doc td{border:1px solid #ccc;padding:4px 7px;text-align:left;}',
		'  .ciyex-printable-doc thead th{background:#eef3f8 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
		'  .ciyex-printable-doc .amt{text-align:right;white-space:nowrap;}',
		'  .ciyex-printable-doc .claim{break-inside:avoid;page-break-inside:avoid;margin:12px 0;}',
		'  .ciyex-printable-doc .figs{font-size:11px;color:#444 !important;margin:2px 0 5px;}',
		'  .ciyex-printable-doc .pill{font-size:10px;border:1px solid #999;border-radius:8px;padding:1px 7px;font-weight:600;}',
		'  .ciyex-printable-doc .summary th{background:#f6f8fa !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;white-space:nowrap;}',
		'  .ciyex-printable-doc .due{margin-top:14px;padding:10px;border:1px solid #f0c36d;font-size:12px;}',
		'  .ciyex-printable-doc body,.ciyex-printable-doc .stmt{font-family:Arial,Helvetica,sans-serif;}',
		extraPrintCss,
		'  @page{margin:12mm;}',
		'}',
	].join('\n');
	doc.head.appendChild(style);

	try {
		return await nativeHostService.savePdfToDownloads(fileName);
	} finally {
		mount.remove();
		style.remove();
	}
}
