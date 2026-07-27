/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../../base/browser/dom.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { claimNumberForFeeSheet } from '../billing/edi837.js';
import { findWorkbenchRoot } from '../customDropdown.js';

/**
 * Shared patient-ledger view: one chronological financial record built from
 * the billed fee sheets (charges) and the payment transactions (insurance
 * postings, patient payments, write-offs, patient portions). Used by BOTH the
 * Payments editor's Ledger tab (all patients) and the patient chart's
 * Financial > Ledger page (one patient) so the two stay identical.
 *
 * The EOB `key=value` description fields and the notes `sec=`/`sl=` segments
 * parsed here are written by the Insurance Posting flow in clinicalEditors.ts
 * (_saveEobPosting / _postSecondaryEob) — that file is the encoding's source
 * of truth.
 */

export type LedgerEventType = 'charge' | 'ins-payment' | 'ins-payment-secondary' | 'writeoff' | 'patient-payment' | 'patient-portion';

export interface LedgerEvent {
	/** Stable per-entry id (type + patient + claim + date + amounts) used to persist local deletes. */
	id: string;
	/** ISO date (yyyy-mm-dd) the event happened (posting / transaction date). */
	date: string;
	/** ISO date of the underlying service / encounter (DOS); '' when it can't be resolved. */
	serviceDate: string;
	/** Millisecond timestamp for ordering (events on the same day keep charge → payment order). */
	sortKey: number;
	patientId: string;
	patientName: string;
	type: LedgerEventType;
	claimRef: string;
	description: string;
	/** Amount charged to the account (increases the balance). */
	debit: number;
	/** Amount paid / adjusted off the account (reduces the balance). */
	credit: number;
	/** Informational amount for patient-portion rows — due, not yet paid, so it moves no balance. */
	info: number;
	/** Running balance of THIS PATIENT's account after the event. */
	balance: number;
}

export interface LedgerTotals {
	charges: number;
	insurancePaid: number;
	patientPaid: number;
	adjustments: number;
	patientPortionDue: number;
	outstanding: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toFixed(2)}`;

/** Parse a `key=value` number out of an EOB posting description. */
function descField(description: string, field: string): number | undefined {
	const m = description.match(new RegExp(`${field}=(-?\\d+(?:\\.\\d+)?)`));
	return m ? Number(m[1]) : undefined;
}

/** Parse a `key=value` string out of an EOB posting description. */
function descText(description: string, field: string): string {
	return description.match(new RegExp(`${field}=([^;|]+)`))?.[1]?.trim() || '';
}

/** Total the secondary payer's payments out of the notes `sl=` segment (0 when not posted). */
function secondaryPaid(notes: string): { payer: string; check: string; paid: number; posted: boolean } {
	const raw = String(notes ?? '');
	const sec = raw.match(/(?:^|\| ?)sec=([^|]+)/);
	if (!sec) { return { payer: '', check: '', paid: 0, posted: false }; }
	const [payer, check, , posted] = sec[1].split('~');
	let paid = 0;
	const sl = raw.match(/(?:^|\| ?)sl=([^|]+)/);
	if (sl) {
		for (const part of sl[1].split(';')) {
			const seg = part.split('~');
			paid += Number(seg[2]) || 0;
		}
	}
	return { payer: (payer || '').trim(), check: (check || '').trim(), paid: round2(paid), posted: posted?.trim() === '1' };
}

function isoDate(value: unknown): string {
	const s = String(value ?? '');
	if (/^\d{4}-\d{2}-\d{2}/.test(s)) { return s.slice(0, 10); }
	const t = new Date(s).getTime();
	if (Number.isFinite(t)) { return new Date(t).toISOString().slice(0, 10); }
	return '';
}

function usDate(iso: string): string {
	const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
	return m ? `${m[2]}/${m[3]}/${m[1]}` : (iso || '—');
}

function listOf(payload: unknown): Array<Record<string, unknown>> {
	const p = payload as { data?: unknown; content?: unknown } | unknown[] | null;
	const w = (p as { data?: unknown })?.data ?? p;
	const list = (w as { content?: unknown })?.content ?? w;
	return Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
}

/**
 * Build the ledger events from the fee sheets + payment transactions.
 * With `patientId` set only that patient's events are returned; the running
 * balance is always computed per patient either way.
 */
export async function buildLedgerEvents(apiService: ICiyexApiService, patientId?: string): Promise<LedgerEvent[]> {
	const [txnsRaw, sheetsRaw] = await Promise.all([
		apiService.fetch('/api/payments/transactions').then(async r => r.ok ? await r.json() : null).catch(() => null),
		apiService.fetch('/api/fee-sheets').then(async r => r.ok ? await r.json() : null).catch(() => null),
	]);
	const txns = listOf(txnsRaw);
	const sheets = listOf(sheetsRaw);

	const events: LedgerEvent[] = [];
	const wanted = (pid: string) => !patientId || String(pid) === String(patientId);
	// claimRef → date of service, so payment/EOB rows can show the DOS of the
	// charge they settle even though the transaction record only has a post date.
	const serviceDateByClaim = new Map<string, string>();

	// -- Charges: every billed fee sheet is a charge on the patient account --
	for (const s of sheets) {
		if (!/^(billed|paid|eob)/i.test(String(s['billingStatus'] ?? ''))) { continue; }
		const pid = String(s['patientId'] ?? '');
		if (!wanted(pid)) { continue; }
		const items = (s['items'] as Array<Record<string, unknown>>) || [];
		const codes: string[] = [];
		let billed = 0;
		for (const it of items) {
			if (String(it['type'] ?? '') === 'ICD10' || !it['code']) { continue; }
			codes.push(String(it['code']));
			billed += (Number(it['price'] ?? 0) || 0) * (Number(it['qty'] ?? 1) || 1);
		}
		billed = round2(billed);
		if (billed <= 0) { continue; }
		const date = isoDate(s['billedAt'] ?? s['encounterDate'] ?? s['serviceDate'] ?? s['updatedAt'] ?? s['createdAt']);
		const serviceDate = isoDate(s['serviceDate'] ?? s['encounterDate'] ?? s['dateOfService'] ?? s['billedAt'] ?? s['createdAt']);
		const claimRef = String(s['claimNumber'] ?? '') || claimNumberForFeeSheet(String(s['id'] ?? ''));
		if (claimRef && serviceDate) { serviceDateByClaim.set(claimRef, serviceDate); }
		events.push({
			id: '', date, serviceDate, sortKey: new Date(date || 0).getTime(),
			patientId: pid, patientName: String(s['patientName'] ?? ''),
			type: 'charge',
			claimRef,
			description: `Charges billed — ${codes.join(', ') || 'services'}`,
			debit: billed, credit: 0, info: 0, balance: 0,
		});
	}

	// -- Transactions: insurance postings, patient payments, patient portions --
	for (const t of txns) {
		const pid = String(t['patientId'] ?? '');
		if (!wanted(pid)) { continue; }
		const desc = String(t['description'] ?? '');
		const notes = String(t['notes'] ?? '');
		const patientName = String(t['patientName'] ?? '');
		const status = String(t['status'] ?? '').toLowerCase();
		const date = isoDate(t['collectedAt'] ?? t['transactionDate'] ?? t['createdAt']);
		const sortKey = new Date(date || 0).getTime() + 1; // same-day payments sort after the charge
		const amount = Number(t['amount']) || 0;
		const isEob = String(t['transactionType'] ?? '') === 'insurance_payment' || desc.startsWith('EOB posting');

		// DOS of the settled claim (falls back to the transaction's own date when unknown).
		const svc = (ref: string) => serviceDateByClaim.get(ref) || isoDate(t['serviceDate'] ?? t['dateOfService']) || '';

		if (isEob) {
			const claimRef = descText(desc, 'claim');
			const payer = descText(desc, 'payer');
			const check = descText(desc, 'check');
			const sec = secondaryPaid(notes);
			const combinedPaid = descField(desc, 'paid') ?? amount;
			const primaryPaid = round2(combinedPaid - (sec.posted ? sec.paid : 0));
			const writeOff = descField(desc, 'writeoff') ?? 0;
			if (primaryPaid > 0) {
				events.push({
					id: '', date, serviceDate: svc(claimRef), sortKey, patientId: pid, patientName, type: 'ins-payment', claimRef,
					description: `Insurance payment — ${payer || 'payer'}${check ? `, check ${check}` : ''}`,
					debit: 0, credit: primaryPaid, info: 0, balance: 0,
				});
			}
			if (sec.posted && sec.paid > 0) {
				events.push({
					id: '', date, serviceDate: svc(claimRef), sortKey: sortKey + 1, patientId: pid, patientName, type: 'ins-payment-secondary', claimRef,
					description: `Secondary insurance payment — ${sec.payer || 'secondary payer'}${sec.check ? `, check ${sec.check}` : ''}`,
					debit: 0, credit: sec.paid, info: 0, balance: 0,
				});
			}
			if (writeOff > 0) {
				events.push({
					id: '', date, serviceDate: svc(claimRef), sortKey: sortKey + 2, patientId: pid, patientName, type: 'writeoff', claimRef,
					description: `Contractual write-off / adjustment — ${payer || 'payer'}`,
					debit: 0, credit: writeOff, info: 0, balance: 0,
				});
			}
			continue;
		}

		// Pending patient-responsibility records = the PATIENT PORTION still due.
		const claimFromDesc = desc.match(/claim ([A-Z]+-?\d+)/)?.[1] || '';
		if (status === 'pending' && ['copay', 'deductible', 'coinsurance'].includes(String(t['transactionType'] ?? ''))) {
			events.push({
				id: '', date, serviceDate: svc(claimFromDesc), sortKey: sortKey + 3, patientId: pid, patientName, type: 'patient-portion', claimRef: claimFromDesc,
				description: desc || 'Patient responsibility due',
				debit: 0, credit: 0, info: round2(amount), balance: 0,
			});
			continue;
		}

		// Actual patient money: completed payments credit the account, refunds re-open it.
		if (status === 'completed' && amount > 0) {
			events.push({
				id: '', date, serviceDate: svc(claimFromDesc), sortKey: sortKey + 3, patientId: pid, patientName, type: 'patient-payment', claimRef: claimFromDesc,
				description: desc || `Patient payment (${String(t['paymentMethodType'] ?? 'payment')})`,
				debit: 0, credit: round2(amount), info: 0, balance: 0,
			});
		} else if (status === 'refunded' && amount > 0) {
			events.push({
				id: '', date, serviceDate: svc(claimFromDesc), sortKey: sortKey + 3, patientId: pid, patientName, type: 'patient-payment', claimRef: claimFromDesc,
				description: `Refund to patient — ${desc || 'refunded payment'}`,
				debit: round2(amount), credit: 0, info: 0, balance: 0,
			});
		}
	}

	// -- Per-patient running balance, oldest → newest --
	events.sort((a, b) => a.sortKey - b.sortKey);
	const balances = new Map<string, number>();
	const idSeen = new Map<string, number>();
	for (const e of events) {
		const next = round2((balances.get(e.patientId) || 0) + e.debit - e.credit);
		balances.set(e.patientId, next);
		e.balance = next;
		// Stable id (survives reloads) so a local delete keeps hiding the same row.
		const base = `${e.type}|${e.patientId}|${e.claimRef}|${e.date}|${e.debit}|${e.credit}|${e.info}`;
		const n = (idSeen.get(base) || 0) + 1;
		idSeen.set(base, n);
		e.id = n > 1 ? `${base}#${n}` : base;
	}
	// Newest first for display.
	events.reverse();
	return events;
}

/** Recompute each patient's running balance over a newest-first event list (used after local deletes). */
function recomputeBalances(newestFirst: LedgerEvent[]): void {
	const balances = new Map<string, number>();
	for (let i = newestFirst.length - 1; i >= 0; i--) {
		const e = newestFirst[i];
		const next = round2((balances.get(e.patientId) || 0) + e.debit - e.credit);
		balances.set(e.patientId, next);
		e.balance = next;
	}
}

/** Column totals across a set of ledger events. */
export function ledgerTotals(events: LedgerEvent[]): LedgerTotals {
	let charges = 0; let insurancePaid = 0; let patientPaid = 0; let adjustments = 0; let portion = 0;
	for (const e of events) {
		switch (e.type) {
			case 'charge': charges += e.debit; break;
			case 'ins-payment':
			case 'ins-payment-secondary': insurancePaid += e.credit; break;
			case 'writeoff': adjustments += e.credit; break;
			case 'patient-payment': patientPaid += e.credit - e.debit; break;
			case 'patient-portion': portion += e.info; break;
		}
	}
	return {
		charges: round2(charges),
		insurancePaid: round2(insurancePaid),
		patientPaid: round2(patientPaid),
		adjustments: round2(adjustments),
		patientPortionDue: round2(portion),
		outstanding: round2(charges - insurancePaid - adjustments - patientPaid),
	};
}

const TYPE_META: Record<LedgerEventType, { label: string; color: string }> = {
	'charge': { label: 'Charge', color: '#3b82f6' },
	'ins-payment': { label: 'Insurance Payment', color: '#3b9edd' },
	'ins-payment-secondary': { label: 'Secondary Ins Payment', color: '#8b5cf6' },
	'writeoff': { label: 'Write-off / Adj', color: '#a78bfa' },
	'patient-payment': { label: 'Patient Payment', color: '#22c55e' },
	'patient-portion': { label: 'Patient Portion Due', color: '#f59e0b' },
};

/**
 * Host services the ledger's per-row Actions column needs. Supplied by both the
 * Payments editor and the patient chart (each backs it with its own storage,
 * file service and dialogs) so the shared table can offer View / Download /
 * Delete without depending on VS Code services directly.
 */
export interface ILedgerActionsHost {
	/** Locally-hidden entry ids (kept per patient in the host's storage). */
	readHidden(): Set<string>;
	/** Persist the updated hidden-id set. */
	writeHidden(ids: Set<string>): void;
	/** Save a generated single-entry statement file locally (no native Save dialog). */
	saveStatement(fileName: string, html: string): Promise<void>;
	/** Confirm a delete; resolve true to proceed. */
	confirmDelete(message: string): Promise<boolean>;
	/** Brief info toast. */
	notify(message: string): void;
}

/**
 * Build an {@link ILedgerActionsHost} from primitive, service-backed callbacks
 * so each editor keeps its own storage / file / dialog services while sharing
 * the hidden-id (de)serialization. `loadHidden`/`storeHidden` persist a JSON
 * array of deleted entry ids — key it per patient for a patient-scoped ledger.
 */
export function makeLedgerActionsHost(deps: {
	loadHidden: () => string;
	storeHidden: (json: string) => void;
	saveFile: (fileName: string, html: string) => Promise<void>;
	confirmDelete: (message: string) => Promise<boolean>;
	notify: (message: string) => void;
}): ILedgerActionsHost {
	return {
		readHidden: () => {
			try {
				const parsed = JSON.parse(deps.loadHidden() || '[]');
				return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
			} catch {
				return new Set<string>();
			}
		},
		writeHidden: ids => deps.storeHidden(JSON.stringify([...ids])),
		saveStatement: deps.saveFile,
		confirmDelete: deps.confirmDelete,
		notify: deps.notify,
	};
}

export interface IRenderLedgerOptions {
	/** Show the Patient column (all-patients view); off for the chart's single-patient page. */
	showPatientColumn: boolean;
	/** Initial text filter (e.g. the Payments patient bar selection). */
	initialFilter?: string;
	/**
	 * Called on every filter edit so the host can remember what the user typed.
	 * The ledger re-renders whenever it reloads (Refresh, tab switch, patient
	 * pick) and without this the box fell back to `initialFilter` — which is
	 * what made a cleared filter reappear on its own (QA 27-Jul).
	 */
	onFilterChange?: (value: string) => void;
	/** When set, render a per-row Actions column (View / Download / Delete) backed by this host. */
	actionsHost?: ILedgerActionsHost;
}

/**
 * Render summary cards + a filterable ledger table into `host`. Every row is
 * one financial event with explicit Debit / Credit columns and the patient's
 * running balance after it.
 */
export function renderLedger(host: HTMLElement, events: LedgerEvent[], opts: IRenderLedgerOptions): void {
	DOM.clearNode(host);

	// -- Summary cards --
	const cards = DOM.append(host, DOM.$('div'));
	cards.style.cssText = 'display:flex;gap:12px;margin-bottom:12px;flex-wrap:wrap;';
	const card = (label: string, value: string, color: string) => {
		const c = DOM.append(cards, DOM.$('div'));
		c.style.cssText = 'flex:0 0 158px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:10px 14px;text-align:center;';
		const v = DOM.append(c, DOM.$('div')); v.textContent = value; v.style.cssText = `font-size:17px;font-weight:700;color:${color};`;
		const l = DOM.append(c, DOM.$('div')); l.textContent = label; l.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);margin-top:2px;';
		return v;
	};
	const totalsEls = {
		charges: card('Total Charges', money(0), 'var(--vscode-foreground)'),
		insurancePaid: card('Insurance Paid', money(0), '#3b9edd'),
		patientPaid: card('Patient Paid', money(0), '#22c55e'),
		adjustments: card('Write-offs / Adj', money(0), '#8b5cf6'),
		patientPortionDue: card('Patient Portion Due', money(0), '#f59e0b'),
		outstanding: card('Outstanding Balance', money(0), '#ef4444'),
	};

	// -- Filter bar --
	const bar = DOM.append(host, DOM.$('div'));
	bar.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px;';
	const search = DOM.append(bar, DOM.$('input')) as HTMLInputElement;
	search.placeholder = opts.showPatientColumn ? 'Filter by patient, claim #, type, description...' : 'Filter by claim #, type, description...';
	search.value = opts.initialFilter || '';
	search.style.cssText = 'flex:0 0 340px;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#555);border-radius:6px;color:var(--vscode-input-foreground);font-size:12px;';
	const countEl = DOM.append(bar, DOM.$('span'));
	countEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
	// Clear button — clearing the box must STAY cleared (the host is told, so a
	// later reload doesn't restore the patient-bar name).
	const clearBtn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
	clearBtn.textContent = 'Clear';
	clearBtn.title = 'Clear the ledger filter';
	clearBtn.style.cssText = 'padding:5px 10px;background:transparent;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:11px;';

	// -- Table --
	const host2 = opts.actionsHost;
	const scroll = DOM.append(host, DOM.$('div'));
	scroll.style.cssText = 'flex:1;min-height:0;overflow:auto;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';
	// Columns: Date · Service Date · [Patient] · Type · Claim # · Description · Debit · Credit · Balance · [Actions]
	const patientCol = opts.showPatientColumn ? 'minmax(110px,1fr) ' : '';
	const actionsCol = host2 ? ' 108px' : '';
	const COLS = `88px 92px ${patientCol}138px 76px minmax(180px,1.8fr) 84px 88px 92px${actionsCol}`;
	const header = DOM.append(scroll, DOM.$('div'));
	header.style.cssText = `display:grid;grid-template-columns:${COLS};gap:8px;padding:9px 12px;position:sticky;top:0;background:var(--vscode-editor-background);border-bottom:2px solid var(--vscode-editorWidget-border);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);z-index:1;`;
	const heads = ['Date', 'Service Date',
		...(opts.showPatientColumn ? ['Patient'] : []),
		'Type', 'Claim #', 'Description', 'Debit', 'Credit', 'Balance',
		...(host2 ? ['Actions'] : [])];
	for (const h of heads) { DOM.append(header, DOM.$('span')).textContent = h; }

	const body = DOM.append(scroll, DOM.$('div'));

	const renderRows = () => {
		DOM.clearNode(body);
		const q = search.value.trim().toLowerCase();
		// Locally-deleted rows are hidden and the running balance recomputed over
		// what's left, so the ledger stays internally consistent after a delete.
		const hidden = host2 ? host2.readHidden() : new Set<string>();
		const active = hidden.size ? events.filter(e => !hidden.has(e.id)) : events;
		if (hidden.size) { recomputeBalances(active); }
		const visible = active.filter(e => {
			if (!q) { return true; }
			return `${e.patientName} ${e.claimRef} ${TYPE_META[e.type].label} ${e.description} ${e.date} ${e.serviceDate}`.toLowerCase().includes(q);
		});

		const totals = ledgerTotals(visible);
		totalsEls.charges.textContent = money(totals.charges);
		totalsEls.insurancePaid.textContent = money(totals.insurancePaid);
		totalsEls.patientPaid.textContent = money(totals.patientPaid);
		totalsEls.adjustments.textContent = money(totals.adjustments);
		totalsEls.patientPortionDue.textContent = money(totals.patientPortionDue);
		totalsEls.outstanding.textContent = money(totals.outstanding);
		countEl.textContent = `${visible.length} entr${visible.length === 1 ? 'y' : 'ies'}`;

		if (visible.length === 0) {
			const e = DOM.append(body, DOM.$('div'));
			e.textContent = q
				? 'No ledger entries match the filter.'
				: 'No financial activity yet — bill a fee sheet and its charges, payments and adjustments show here.';
			e.style.cssText = 'padding:18px;color:var(--vscode-descriptionForeground);font-size:13px;font-style:italic;';
			return;
		}

		for (const ev of visible) {
			const meta = TYPE_META[ev.type];
			const r = DOM.append(body, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${COLS};gap:8px;align-items:center;padding:7px 12px;border-top:1px solid rgba(128,128,128,0.1);font-size:12px;`;
			DOM.append(r, DOM.$('span')).textContent = usDate(ev.date);
			const dosEl = DOM.append(r, DOM.$('span'));
			dosEl.textContent = ev.serviceDate ? usDate(ev.serviceDate) : '—';
			dosEl.title = 'Date of service';
			dosEl.style.cssText = 'color:var(--vscode-descriptionForeground);';
			if (opts.showPatientColumn) {
				const p = DOM.append(r, DOM.$('span'));
				const label = ev.patientName || (ev.patientId ? `Patient #${ev.patientId}` : '—');
				p.textContent = label;
				p.title = 'Filter the ledger to this patient';
				p.style.cssText = 'font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;';
				p.addEventListener('click', () => { search.value = label; opts.onFilterChange?.(label); renderRows(); });
			}
			const typeEl = DOM.append(r, DOM.$('span'));
			const badge = DOM.append(typeEl, DOM.$('span'));
			badge.textContent = meta.label;
			badge.style.cssText = `display:inline-block;padding:2px 8px;border-radius:9px;font-size:10px;font-weight:600;color:${meta.color};border:1px solid ${meta.color}55;background:${meta.color}14;white-space:nowrap;`;
			const claimEl = DOM.append(r, DOM.$('span'));
			claimEl.textContent = ev.claimRef || '—';
			claimEl.style.cssText = 'font-family:var(--vscode-editor-font-family,monospace);font-size:11px;';
			const descEl = DOM.append(r, DOM.$('span'));
			descEl.textContent = ev.description;
			descEl.title = ev.description;
			descEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground);';
			const debitEl = DOM.append(r, DOM.$('span'));
			debitEl.textContent = ev.debit > 0 ? money(ev.debit) : '';
			debitEl.style.cssText = 'text-align:right;font-weight:600;';
			const creditEl = DOM.append(r, DOM.$('span'));
			// A due-from-patient row carries its amount in the Credit column as
			// context ("(due $x)") so billers see it without it moving the math.
			creditEl.textContent = ev.credit > 0 ? money(ev.credit) : (ev.type === 'patient-portion' ? `(due ${money(ev.info)})` : '');
			creditEl.style.cssText = `text-align:right;font-weight:600;color:${ev.type === 'patient-portion' ? '#f59e0b' : '#22c55e'};`;
			const balEl = DOM.append(r, DOM.$('span'));
			balEl.textContent = money(ev.balance);
			balEl.style.cssText = `text-align:right;font-weight:700;color:${ev.balance > 0.005 ? '#ef4444' : 'var(--vscode-foreground)'};`;

			// -- Actions: View (detail) · Download (single-entry statement) · Delete (local hide) --
			if (host2) {
				const actions = DOM.append(r, DOM.$('span'));
				actions.style.cssText = 'display:flex;gap:4px;justify-content:flex-end;';
				const actBtn = (icon: string, tip: string, color: string, run: () => void) => {
					const b = DOM.append(actions, DOM.$('button')) as HTMLButtonElement;
					b.textContent = icon;
					b.title = tip;
					b.style.cssText = `background:transparent;border:1px solid ${color}44;color:${color};border-radius:5px;width:26px;height:24px;cursor:pointer;font-size:13px;line-height:1;padding:0;`;
					b.addEventListener('click', e => { e.stopPropagation(); run(); });
					return b;
				};
				actBtn('\u{1F441}', 'View full details', 'var(--vscode-foreground)', () => showLedgerEntry(host, ev, opts.showPatientColumn));
				actBtn('\u{2B07}', 'Download this entry', '#3b9edd', () => { downloadLedgerEntry(host2, ev); });
				actBtn('\u{1F5D1}', 'Delete from this ledger view', '#ef4444', async () => {
					const ok = await host2.confirmDelete(`Remove this ${TYPE_META[ev.type].label.toLowerCase()} entry from the ledger view? It won't affect the underlying charge or payment record.`);
					if (!ok) { return; }
					const set = host2.readHidden();
					set.add(ev.id);
					host2.writeHidden(set);
					host2.notify('Ledger entry removed from the view.');
					renderRows();
				});
			}
		}
	};

	search.addEventListener('input', () => { opts.onFilterChange?.(search.value); renderRows(); });
	clearBtn.addEventListener('click', () => {
		search.value = '';
		opts.onFilterChange?.('');
		renderRows();
		search.focus();
	});
	renderRows();
}

/** The full field list for one ledger entry (shared by the View modal and the Download receipt). */
function ledgerEntryFields(ev: LedgerEvent, showPatient: boolean): Array<[string, string]> {
	const rows: Array<[string, string]> = [
		['Type', TYPE_META[ev.type].label],
		['Posting Date', usDate(ev.date)],
		['Date of Service', ev.serviceDate ? usDate(ev.serviceDate) : '—'],
	];
	if (showPatient) { rows.push(['Patient', ev.patientName || (ev.patientId ? `Patient #${ev.patientId}` : '—')]); }
	rows.push(
		['Claim #', ev.claimRef || '—'],
		['Description', ev.description || '—'],
		['Debit (charge)', ev.debit > 0 ? money(ev.debit) : '—'],
		['Credit (paid / adjusted)', ev.credit > 0 ? money(ev.credit) : '—'],
	);
	if (ev.type === 'patient-portion') { rows.push(['Patient portion due', money(ev.info)]); }
	rows.push(['Running Balance', money(ev.balance)]);
	return rows;
}

/**
 * Modal listing every field of a ledger entry, mounted on the workbench root so
 * it escapes the editor's clipping. It must NOT go on `document.body`: the
 * `--vscode-*` theme variables live on `.monaco-workbench`, so a body-mounted
 * box resolved every `var(--vscode-editor-background)` to nothing and rendered
 * see-through over the ledger (QA 27-Jul: "the view page is showing like
 * transparent — add the background colour theme wise"). Mounting inside the
 * workbench (and copying its class) makes the panel opaque in every theme.
 */
function showLedgerEntry(host: HTMLElement, ev: LedgerEvent, showPatient: boolean): void {
	const doc = host.ownerDocument;
	const mount = findWorkbenchRoot(host, doc);
	const overlay = DOM.append(mount, DOM.$('div'));
	overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
	// The copied workbench class also carries an opaque page background — reset it
	// so only the scrim below dims the ledger behind the modal.
	overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:100000;display:flex;align-items:center;justify-content:center;color:var(--vscode-foreground);';
	const close = () => overlay.remove();
	overlay.addEventListener('click', e => { if (e.target === overlay) { close(); } });

	const box = DOM.append(overlay, DOM.$('div'));
	box.style.cssText = 'width:460px;max-width:92vw;max-height:82vh;overflow:auto;background:var(--vscode-editorWidget-background, var(--vscode-editor-background, var(--vscode-menu-background)));color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
	const head = DOM.append(box, DOM.$('div'));
	head.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);`;
	const title = DOM.append(head, DOM.$('div'));
	title.textContent = 'Ledger Entry';
	title.style.cssText = 'font-size:15px;font-weight:600;';
	const meta = TYPE_META[ev.type];
	const badge = DOM.append(head, DOM.$('span'));
	badge.textContent = meta.label;
	badge.style.cssText = `margin-left:auto;padding:2px 9px;border-radius:9px;font-size:10px;font-weight:600;color:${meta.color};border:1px solid ${meta.color}55;background:${meta.color}14;`;
	const x = DOM.append(head, DOM.$('button')) as HTMLButtonElement;
	x.textContent = '\u{2715}';
	x.style.cssText = 'background:transparent;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:15px;';
	x.addEventListener('click', close);

	const grid = DOM.append(box, DOM.$('div'));
	grid.style.cssText = 'display:grid;grid-template-columns:auto 1fr;gap:8px 16px;padding:16px;font-size:13px;';
	for (const [label, value] of ledgerEntryFields(ev, showPatient)) {
		const l = DOM.append(grid, DOM.$('div')); l.textContent = label;
		l.style.cssText = 'color:var(--vscode-descriptionForeground);white-space:nowrap;';
		const v = DOM.append(grid, DOM.$('div')); v.textContent = value;
		v.style.cssText = 'font-weight:500;word-break:break-word;';
	}
}

/** Build a one-entry HTML receipt and hand it to the host to save locally. */
function downloadLedgerEntry(actionsHost: ILedgerActionsHost, ev: LedgerEvent): void {
	const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const rowsHtml = ledgerEntryFields(ev, true)
		.map(([l, v]) => `<tr><th>${esc(l)}</th><td>${esc(v)}</td></tr>`)
		.join('\n');
	const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Ledger Entry — ${esc(ev.claimRef || TYPE_META[ev.type].label)}</title><style>
body{font-family:Arial,sans-serif;color:#222;margin:24px;}
h1{font-size:18px;} table{border-collapse:collapse;margin-top:12px;font-size:13px;}
th,td{border:1px solid #ccc;padding:6px 12px;text-align:left;} th{background:#f0f4f8;white-space:nowrap;}
</style></head><body>
<h1>Ledger Entry — ${esc(TYPE_META[ev.type].label)}</h1>
<table>${rowsHtml}</table>
</body></html>`;
	const stamp = (ev.claimRef || ev.type).replace(/[^a-z0-9]+/gi, '-').toLowerCase();
	actionsHost.saveStatement(`ledger-entry-${stamp}-${ev.date || 'entry'}.html`, html);
}
