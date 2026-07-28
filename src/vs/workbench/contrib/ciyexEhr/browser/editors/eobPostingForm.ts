/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { findWorkbenchRoot } from '../customDropdown.js';

/** One billable service line of a claim inside the EOB posting form. */
export interface EobLine {
	code: string;
	description: string;
	/** Charge submitted on the claim (prefilled from the fee sheet). */
	billed: number;
	/** Payer-allowed amount from the EOB. */
	allowed: number;
	/** Insurance-paid amount from the EOB. */
	paid: number;
	/** Per-line patient-responsibility split from the EOB (optional — legacy
	 *  postings only carried claim-level values). */
	copay?: number;
	deductible?: number;
	coinsurance?: number;
	/** Per-line contractual write-off / adjustment from the EOB. Defaults to
	 *  billed - allowed until the biller enters an explicit figure. */
	writeOff?: number;
}

/** A billed fee sheet presented as a postable claim in the EOB form. */
export interface EobClaimOption {
	claimRef: string;
	feeSheetId: string;
	patientId: string;
	patientName: string;
	serviceDate?: string;
	/** Encounter the fee sheet was billed from — links the claim to the
	 *  completed appointment whose date is the date of service. */
	encounterId?: string;
	lines: EobLine[];
}

/** Everything the biller entered on the EOB posting form. */
export interface EobFormValues {
	claimRef: string;
	patientId: string;
	patientName: string;
	/** Date of service of the visit the claim was billed from (yyyy-mm-dd). */
	serviceDate?: string;
	payerName: string;
	checkNumber: string;
	paymentMethodType: string;
	billed: number;
	allowed: number;
	paid: number;
	copay: number;
	deductible: number;
	coinsurance: number;
	denialReason: string;
	forwardedToSecondary: boolean;
	secondaryPayer: string;
	lines: EobLine[];
}

interface IEobFormOptions {
	title: string;
	confirmLabel: string;
	/** Fixed claim context (the per-row "Post EOB" action). */
	claim?: EobClaimOption;
	/** Claim picker choices (the toolbar "+ Post Insurance Payment" button). */
	claimOptions?: EobClaimOption[];
	/** Prefill for editing an existing posting. */
	initial?: Partial<EobFormValues>;
	anchor?: HTMLElement;
}

const INPUT_STYLE = 'width:100%;box-sizing:border-box;padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
const LABEL_STYLE = 'display:block;font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:3px;';

function money(n: number): string {
	return `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/**
 * Line-level EOB posting form. Shows every CPT/HCPCS line of the claim with
 * its own Billed / Allowed / Ins Paid inputs (so a 10-code claim gets 10
 * entry rows), claim-level Copay / Deductible / Coinsurance, and live totals
 * (write-off = billed - allowed; patient responsibility = copay + deductible
 * + coinsurance) with a balance check against the EOB. Resolves to the
 * entered values, or `null` when cancelled.
 */
export function showEobPostingForm(opts: IEobFormOptions): Promise<EobFormValues | null> {
	return new Promise<EobFormValues | null>(resolve => {
		const doc = mainWindow.document;
		const mount = findWorkbenchRoot(opts.anchor || doc.body || doc.documentElement, doc);
		const overlay = DOM.append(mount, DOM.$('div'));
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		// background:transparent is required — copying the workbench className
		// also copies its opaque background (see showThemedModal).
		overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;color:var(--vscode-foreground);background:transparent;';
		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.18);';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'position:relative;width:760px;max-width:94vw;max-height:92vh;overflow-y:auto;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,0.45);padding:20px 22px;box-sizing:border-box;';

		const titleEl = DOM.append(modal, DOM.$('h3'));
		titleEl.textContent = opts.title;
		titleEl.style.cssText = 'margin:0 0 2px;font-size:16px;font-weight:600;';
		const subEl = DOM.append(modal, DOM.$('p'));
		subEl.style.cssText = 'margin:0 0 14px;font-size:11px;color:var(--vscode-descriptionForeground);';

		// -- Working state --
		let claim: EobClaimOption | undefined = opts.claim;
		let lines: EobLine[] = (opts.initial?.lines?.length ? opts.initial.lines : claim?.lines || []).map(l => ({ ...l }));
		let patientId = opts.initial?.patientId ?? claim?.patientId ?? '';
		let patientName = opts.initial?.patientName ?? claim?.patientName ?? '';
		let claimRef = opts.initial?.claimRef ?? claim?.claimRef ?? '';

		const setSubtitle = (): void => {
			subEl.textContent = patientName
				? `${patientName}${claimRef ? ` — claim ${claimRef}` : ''}${claim?.serviceDate ? ` — service date ${claim.serviceDate}` : ''}`
				: 'Select the claim this EOB pays, then enter the payer figures per service line.';
		};
		setSubtitle();

		// -- Claim picker (create-from-toolbar path) --
		let manualPatientWrap: HTMLElement | undefined;
		let manualNameInput: HTMLInputElement | undefined;
		let manualIdInput: HTMLInputElement | undefined;
		let manualClaimInput: HTMLInputElement | undefined;
		if (!opts.claim && !opts.initial && opts.claimOptions) {
			const pickWrap = DOM.append(modal, DOM.$('div'));
			pickWrap.style.cssText = 'margin-bottom:14px;';
			const lbl = DOM.append(pickWrap, DOM.$('label'));
			lbl.textContent = 'Claim *';
			lbl.style.cssText = LABEL_STYLE;
			const sel = DOM.append(pickWrap, DOM.$('select')) as HTMLSelectElement;
			sel.style.cssText = INPUT_STYLE + 'cursor:pointer;';
			const ph = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			ph.value = '';
			ph.textContent = opts.claimOptions.length
				? 'Select a billed claim...'
				: 'No billed claims yet — enter the details manually below';
			for (const c of opts.claimOptions) {
				const o = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				o.value = c.feeSheetId;
				const total = c.lines.reduce((s, l) => s + l.billed, 0);
				o.textContent = `${c.claimRef} — ${c.patientName || `Patient #${c.patientId}`} — ${money(total)}${c.serviceDate ? ` (${c.serviceDate})` : ''}`;
			}
			sel.addEventListener('change', () => {
				claim = opts.claimOptions!.find(c => c.feeSheetId === sel.value);
				lines = (claim?.lines || []).map(l => ({ ...l }));
				patientId = claim?.patientId ?? '';
				patientName = claim?.patientName ?? '';
				claimRef = claim?.claimRef ?? '';
				if (manualNameInput) { manualNameInput.value = patientName; }
				if (manualIdInput) { manualIdInput.value = patientId; }
				if (manualClaimInput) { manualClaimInput.value = claimRef; }
				const isManual = !claim;
				if (manualPatientWrap) { manualPatientWrap.style.display = isManual ? 'grid' : 'none'; }
				setSubtitle();
				renderLines();
			});

			// Manual fallback (no claim selected): patient + claim ref inputs so an
			// EOB for a claim billed outside the app can still be posted.
			manualPatientWrap = DOM.append(modal, DOM.$('div'));
			manualPatientWrap.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:14px;';
			const mkManual = (label: string, value: string, placeholder: string): HTMLInputElement => {
				const cell = DOM.append(manualPatientWrap!, DOM.$('div'));
				const l = DOM.append(cell, DOM.$('label'));
				l.textContent = label;
				l.style.cssText = LABEL_STYLE;
				const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
				inp.value = value;
				inp.placeholder = placeholder;
				inp.style.cssText = INPUT_STYLE;
				return inp;
			};
			manualNameInput = mkManual('Patient Name *', patientName, 'e.g. Sophie Littchefiled');
			manualIdInput = mkManual('Patient ID *', patientId, 'e.g. 14');
			manualClaimInput = mkManual('Claim / Bill # *', claimRef, 'e.g. CLM-0012');
			manualNameInput.addEventListener('input', () => { patientName = manualNameInput!.value.trim(); });
			manualIdInput.addEventListener('input', () => { patientId = manualIdInput!.value.trim(); });
			manualClaimInput.addEventListener('input', () => { claimRef = manualClaimInput!.value.trim(); setSubtitle(); });
		}

		// -- Payer / check / method row --
		const payerRow = DOM.append(modal, DOM.$('div'));
		payerRow.style.cssText = 'display:grid;grid-template-columns:2fr 1.2fr 1fr;gap:10px;margin-bottom:14px;';
		const field = (parent: HTMLElement, label: string): HTMLElement => {
			const cell = DOM.append(parent, DOM.$('div'));
			const l = DOM.append(cell, DOM.$('label'));
			l.textContent = label;
			l.style.cssText = LABEL_STYLE;
			return cell;
		};
		const payerInp = DOM.append(field(payerRow, 'Insurance / Payer'), DOM.$('input')) as HTMLInputElement;
		payerInp.placeholder = 'e.g. Medicare, BCBS';
		payerInp.value = opts.initial?.payerName ?? '';
		payerInp.style.cssText = INPUT_STYLE;
		const checkInp = DOM.append(field(payerRow, 'Check / EFT # *'), DOM.$('input')) as HTMLInputElement;
		checkInp.placeholder = 'Check number from EOB';
		checkInp.value = opts.initial?.checkNumber ?? '';
		checkInp.style.cssText = INPUT_STYLE;
		const methodSel = DOM.append(field(payerRow, 'Method'), DOM.$('select')) as HTMLSelectElement;
		methodSel.style.cssText = INPUT_STYLE + 'cursor:pointer;';
		for (const [v, l] of [['check', 'Check'], ['ach', 'ACH / EFT'], ['other', 'Other']]) {
			const o = DOM.append(methodSel, DOM.$('option')) as HTMLOptionElement;
			o.value = v;
			o.textContent = l;
		}
		methodSel.value = opts.initial?.paymentMethodType || 'check';

		// -- Service lines (one entry row per CPT code) --
		const linesTitle = DOM.append(modal, DOM.$('div'));
		linesTitle.style.cssText = LABEL_STYLE + 'margin-bottom:6px;';
		const linesHost = DOM.append(modal, DOM.$('div'));
		linesHost.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;overflow:hidden;margin-bottom:14px;';

		// Claim-level totals inputs — only used when the posting has no line
		// detail (manual claim ref, or editing a legacy aggregate posting).
		let billedInp: HTMLInputElement | undefined;
		let allowedInp: HTMLInputElement | undefined;
		let paidInp: HTMLInputElement | undefined;

		const numVal = (el: HTMLInputElement | undefined): number => {
			const n = Number(el?.value);
			return Number.isFinite(n) ? n : 0;
		};

		const LINE_COLS = '80px minmax(160px,1fr) 92px 92px 92px';
		const renderLines = (): void => {
			DOM.clearNode(linesHost);
			billedInp = allowedInp = paidInp = undefined;
			if (lines.length === 0) {
				linesTitle.textContent = 'EOB Amounts (claim totals)';
				const grid = DOM.append(linesHost, DOM.$('div'));
				grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:12px;';
				const mk = (label: string, value: number | undefined): HTMLInputElement => {
					const inp = DOM.append(field(grid, label), DOM.$('input')) as HTMLInputElement;
					inp.type = 'number';
					inp.step = '0.01';
					inp.min = '0';
					inp.placeholder = '0.00';
					inp.value = value !== undefined && value !== 0 ? String(value) : '';
					inp.style.cssText = INPUT_STYLE;
					inp.addEventListener('input', () => recompute());
					return inp;
				};
				billedInp = mk('Billed ($) *', opts.initial?.billed);
				allowedInp = mk('Allowed ($) *', opts.initial?.allowed);
				paidInp = mk('Insurance Paid ($) *', opts.initial?.paid);
				recompute();
				return;
			}

			linesTitle.textContent = `Service Lines — enter the EOB amounts for each of the ${lines.length} CPT code${lines.length === 1 ? '' : 's'}`;
			const header = DOM.append(linesHost, DOM.$('div'));
			header.style.cssText = `display:grid;grid-template-columns:${LINE_COLS};gap:8px;padding:7px 12px;background:rgba(0,122,204,0.06);font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);`;
			for (const h of ['CPT', 'Description', 'Billed ($)', 'Allowed ($)', 'Ins Paid ($)']) {
				DOM.append(header, DOM.$('span')).textContent = h;
			}
			for (const line of lines) {
				const r = DOM.append(linesHost, DOM.$('div'));
				r.style.cssText = `display:grid;grid-template-columns:${LINE_COLS};gap:8px;align-items:center;padding:6px 12px;border-top:1px solid rgba(128,128,128,0.08);`;
				const codeEl = DOM.append(r, DOM.$('span'));
				codeEl.textContent = line.code;
				codeEl.style.cssText = 'font-weight:600;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;';
				const descEl = DOM.append(r, DOM.$('span'));
				descEl.textContent = line.description || '';
				descEl.title = line.description || '';
				descEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				const mkCell = (value: number, onInput: (n: number) => void, autofocusEmpty = false): HTMLInputElement => {
					const inp = DOM.append(r, DOM.$('input')) as HTMLInputElement;
					inp.type = 'number';
					inp.step = '0.01';
					inp.min = '0';
					inp.placeholder = '0.00';
					inp.value = value ? String(value) : (autofocusEmpty ? '' : String(value));
					inp.style.cssText = INPUT_STYLE;
					inp.addEventListener('input', () => { onInput(Number(inp.value) || 0); recompute(); });
					return inp;
				};
				mkCell(line.billed, n => { line.billed = n; });
				mkCell(line.allowed, n => { line.allowed = n; }, true);
				mkCell(line.paid, n => { line.paid = n; }, true);
			}
			recompute();
		};

		// -- Patient responsibility row --
		const respRow = DOM.append(modal, DOM.$('div'));
		respRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;';
		const mkResp = (label: string, value: number | undefined): HTMLInputElement => {
			const inp = DOM.append(field(respRow, label), DOM.$('input')) as HTMLInputElement;
			inp.type = 'number';
			inp.step = '0.01';
			inp.min = '0';
			inp.placeholder = '0.00';
			inp.value = value ? String(value) : '';
			inp.style.cssText = INPUT_STYLE;
			inp.addEventListener('input', () => recompute());
			return inp;
		};
		const copayInp = mkResp('Copay ($)', opts.initial?.copay);
		const deductibleInp = mkResp('Deductible ($)', opts.initial?.deductible);
		const coinsuranceInp = mkResp('Coinsurance ($)', opts.initial?.coinsurance);

		// -- Live totals strip --
		const totals = DOM.append(modal, DOM.$('div'));
		totals.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 22px;padding:10px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;background:rgba(0,122,204,0.04);margin-bottom:14px;font-size:12px;align-items:center;';
		const totalCell = (label: string): HTMLElement => {
			const c = DOM.append(totals, DOM.$('div'));
			const l = DOM.append(c, DOM.$('div'));
			l.textContent = label;
			l.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);';
			const v = DOM.append(c, DOM.$('div'));
			v.style.cssText = 'font-size:14px;font-weight:700;';
			return v;
		};
		const tBilled = totalCell('Billed');
		const tAllowed = totalCell('Allowed');
		const tPaid = totalCell('Ins Paid');
		const tWriteOff = totalCell('Write-off');
		const tResp = totalCell('Patient Resp');
		tPaid.style.color = '#3b9edd';
		tWriteOff.style.color = '#8b5cf6';
		tResp.style.color = '#f59e0b';
		const balanceHint = DOM.append(totals, DOM.$('div'));
		balanceHint.style.cssText = 'flex:1;min-width:180px;text-align:right;font-size:11px;';

		const currentTotals = (): { billed: number; allowed: number; paid: number; copay: number; deductible: number; coinsurance: number } => {
			const fromLines = lines.length > 0;
			return {
				billed: round2(fromLines ? lines.reduce((s, l) => s + l.billed, 0) : numVal(billedInp)),
				allowed: round2(fromLines ? lines.reduce((s, l) => s + l.allowed, 0) : numVal(allowedInp)),
				paid: round2(fromLines ? lines.reduce((s, l) => s + l.paid, 0) : numVal(paidInp)),
				copay: round2(numVal(copayInp)),
				deductible: round2(numVal(deductibleInp)),
				coinsurance: round2(numVal(coinsuranceInp)),
			};
		};

		const recompute = (): void => {
			const t = currentTotals();
			const writeOff = Math.max(round2(t.billed - t.allowed), 0);
			const resp = round2(t.copay + t.deductible + t.coinsurance);
			tBilled.textContent = money(t.billed);
			tAllowed.textContent = money(t.allowed);
			tPaid.textContent = money(t.paid);
			tWriteOff.textContent = money(writeOff);
			tResp.textContent = money(resp);
			const diff = round2(t.allowed - (t.paid + resp));
			if (t.allowed === 0 && t.paid === 0 && resp === 0) {
				balanceHint.textContent = '';
			} else if (Math.abs(diff) <= 0.01) {
				// allow-any-unicode-next-line
				balanceHint.textContent = '\u2713 Balanced: allowed = paid + patient responsibility';
				balanceHint.style.color = '#22c55e';
			} else {
				// allow-any-unicode-next-line
				balanceHint.textContent = `\u26a0 Allowed \u2260 Ins Paid + Patient Resp (off by ${money(Math.abs(diff))})`;
				balanceHint.style.color = '#f59e0b';
			}
		};

		// -- Denial / COB row --
		const extraRow = DOM.append(modal, DOM.$('div'));
		extraRow.style.cssText = 'display:grid;grid-template-columns:1.4fr 1fr;gap:10px;margin-bottom:16px;align-items:end;';
		const denialInp = DOM.append(field(extraRow, 'Denial / Adjustment Reason'), DOM.$('input')) as HTMLInputElement;
		denialInp.placeholder = 'Only for denials — e.g. CO-97 bundled service';
		denialInp.value = opts.initial?.denialReason ?? '';
		denialInp.style.cssText = INPUT_STYLE;
		const cobCell = DOM.append(extraRow, DOM.$('div'));
		const cobLbl = DOM.append(cobCell, DOM.$('label'));
		cobLbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:6px;';
		const cobChk = DOM.append(cobLbl, DOM.$('input')) as HTMLInputElement;
		cobChk.type = 'checkbox';
		cobChk.checked = opts.initial?.forwardedToSecondary === true;
		DOM.append(cobLbl, DOM.$('span')).textContent = 'Forwarded to secondary (COB)';
		const secondaryInp = DOM.append(cobCell, DOM.$('input')) as HTMLInputElement;
		secondaryInp.placeholder = 'Secondary payer — e.g. BCBS';
		secondaryInp.value = opts.initial?.secondaryPayer ?? '';
		secondaryInp.style.cssText = INPUT_STYLE;
		secondaryInp.disabled = !cobChk.checked;
		cobChk.addEventListener('change', () => { secondaryInp.disabled = !cobChk.checked; });

		// -- Footer --
		const errEl = DOM.append(modal, DOM.$('div'));
		errEl.style.cssText = 'display:none;margin-bottom:10px;font-size:12px;color:var(--vscode-errorForeground,#f48771);';
		const footer = DOM.append(modal, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

		let settled = false;
		const close = (result: EobFormValues | null): void => {
			if (settled) { return; }
			settled = true;
			overlay.remove();
			resolve(result);
		};

		const cancelBtn = DOM.append(footer, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:7px 16px;background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => close(null));

		const confirmBtn = DOM.append(footer, DOM.$('button'));
		confirmBtn.textContent = opts.confirmLabel;
		confirmBtn.style.cssText = 'padding:7px 18px;background:#2e7d32;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
		confirmBtn.addEventListener('click', () => {
			errEl.style.display = 'none';
			const fail = (msg: string, focus?: HTMLElement): void => {
				errEl.textContent = msg;
				errEl.style.display = 'block';
				focus?.focus();
			};
			if (!patientId || !patientName) { fail('Select the claim this EOB pays (or enter the patient manually).'); return; }
			if (!claimRef.trim()) { fail('A claim / bill reference is required so the posting flows back to the Payment Dashboard.', manualClaimInput); return; }
			if (!checkInp.value.trim()) { fail('The check / EFT number from the EOB is required.', checkInp); return; }
			const t = currentTotals();
			if (t.billed <= 0) { fail('Billed amount must be greater than 0.'); return; }
			const denialReason = denialInp.value.trim();
			if (t.paid <= 0 && !denialReason && t.copay + t.deductible + t.coinsurance <= 0) {
				fail('A zero-pay EOB needs a denial reason (or a patient-responsibility amount).', denialInp);
				return;
			}
			close({
				claimRef: claimRef.trim(),
				patientId: String(patientId).trim(),
				patientName: patientName.trim(),
				serviceDate: claim?.serviceDate || opts.initial?.serviceDate,
				payerName: payerInp.value.trim(),
				checkNumber: checkInp.value.trim(),
				paymentMethodType: methodSel.value,
				billed: t.billed,
				allowed: t.allowed,
				paid: t.paid,
				copay: t.copay,
				deductible: t.deductible,
				coinsurance: t.coinsurance,
				denialReason,
				forwardedToSecondary: cobChk.checked,
				secondaryPayer: secondaryInp.value.trim(),
				lines: lines.map(l => ({ ...l })),
			});
		});

		backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { close(null); } });
		overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { close(null); } });

		renderLines();
	});
}
