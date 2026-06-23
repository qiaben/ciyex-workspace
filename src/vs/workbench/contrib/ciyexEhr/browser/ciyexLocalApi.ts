/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * In-app backend for the Price Level and Fee Sheet features.
 *
 * These two features are implemented entirely inside ciyex-workspace and do NOT
 * call the remote `ciyex` API. The data is persisted locally (in the desktop
 * app's localStorage, partitioned per tenant) so the screens work standalone —
 * even when the remote backend is unavailable.
 *
 * {@link tryHandleLocally} mirrors the HTTP contract the editors expect:
 *   - GET/POST    /api/price-levels
 *   - PUT/DELETE  /api/price-levels/{id}
 *   - GET/POST    /api/fee-sheets
 *   - GET         /api/fee-sheets/encounter/{encounterId}
 *   - PUT         /api/fee-sheets/{id}
 *   - POST        /api/fee-sheets/{id}/bill
 *
 * It returns a standard {@link Response} so the calling code (which checks
 * `res.ok`, `res.json()`, `res.status`) needs no changes; non-matching paths
 * return `null` and fall through to the network as before.
 */

interface PriceLevelRecord {
	id: number;
	optionId: string;
	title: string;
	seq: number;
	isDefault: boolean;
	active: boolean;
	notes: string;
	codes: string;
	createdAt: string;
	updatedAt: string;
}

interface FeeSheetRecord {
	id: number;
	encounterId: string | null;
	patientId: string | null;
	patientName: string | null;
	priceLevel: string | null;
	renderingProvider: string | null;
	supervisingProvider: string | null;
	total: number;
	totalPaid: number;
	billingStatus: string;
	billedMode: string;
	paymentStatus: string;
	items: Array<Record<string, unknown>>;
	encounterDate: string | null;
	createdAt: string;
	updatedAt: string;
}

const PRICE_LEVELS_KEY = 'ciyex_local_price_levels';
const FEE_SHEETS_KEY = 'ciyex_local_fee_sheets';

function tenantKey(baseKey: string): string {
	let tenant = 'default';
	try {
		tenant = localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') || 'default';
	} catch { /* localStorage unavailable */ }
	return `${baseKey}::${tenant}`;
}

function load<T>(baseKey: string): T[] {
	try {
		const raw = localStorage.getItem(tenantKey(baseKey));
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed as T[] : [];
	} catch {
		return [];
	}
}

function save<T>(baseKey: string, rows: T[]): void {
	try {
		localStorage.setItem(tenantKey(baseKey), JSON.stringify(rows));
	} catch { /* quota / unavailable — best effort */ }
}

function nextId(rows: Array<{ id: number }>): number {
	return rows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
}

function nowIso(): string {
	return new Date().toISOString();
}

function json(body: unknown, status = 200): Response {
	return new Response(body === undefined ? '' : JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function parseBody(options?: RequestInit): Record<string, unknown> {
	if (!options?.body || typeof options.body !== 'string') { return {}; }
	try {
		const parsed = JSON.parse(options.body);
		return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function method(options?: RequestInit): string {
	return (options?.method || 'GET').toUpperCase();
}

/** True when the value is neither null nor undefined. */
function notNil(v: unknown): boolean {
	return v !== null && v !== undefined;
}

/** Coerce a present value to a string, otherwise null. */
function strOrNull(v: unknown): string | null {
	return notNil(v) ? String(v) : null;
}

/** Slugify a title into a stable, URL-safe option id, unique within the org. */
function generateOptionId(title: string, existing: Set<string>): string {
	let base = (title || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	if (!base) { base = 'level'; }
	let candidate = base;
	let n = 1;
	while (existing.has(candidate)) {
		candidate = `${base}-${++n}`;
	}
	return candidate;
}

// ---------------- Price Levels ----------------

function handlePriceLevels(path: string, options?: RequestInit): Response {
	const rows = load<PriceLevelRecord>(PRICE_LEVELS_KEY);
	const verb = method(options);
	const idMatch = /^\/api\/price-levels\/([^/]+)$/.exec(path);

	if (path === '/api/price-levels' && verb === 'GET') {
		return json(rows.sort((a, b) => a.seq - b.seq));
	}

	if (path === '/api/price-levels' && verb === 'POST') {
		const body = parseBody(options);
		const existing = new Set(rows.map(r => r.optionId));
		const requested = String(body.optionId ?? '').trim();
		const optionId = requested || generateOptionId(String(body.title ?? ''), existing);
		const isDefault = body.isDefault === true;
		// Only one default at a time.
		if (isDefault) { rows.forEach(r => { r.isDefault = false; }); }
		const record: PriceLevelRecord = {
			id: nextId(rows),
			optionId,
			title: String(body.title ?? ''),
			seq: Number(body.seq ?? 0) || 0,
			isDefault,
			active: body.active !== false,
			notes: String(body.notes ?? ''),
			codes: String(body.codes ?? ''),
			createdAt: nowIso(),
			updatedAt: nowIso(),
		};
		rows.push(record);
		save(PRICE_LEVELS_KEY, rows);
		return json(record);
	}

	if (idMatch && verb === 'PUT') {
		const id = Number(idMatch[1]);
		const record = rows.find(r => r.id === id);
		if (!record) { return json({ message: 'Price level not found' }, 404); }
		const body = parseBody(options);
		if (body.optionId !== undefined) { record.optionId = String(body.optionId); }
		if (body.title !== undefined) { record.title = String(body.title); }
		if (body.seq !== undefined) { record.seq = Number(body.seq) || 0; }
		if (body.isDefault !== undefined) {
			record.isDefault = body.isDefault === true;
			if (record.isDefault) { rows.forEach(r => { if (r.id !== id) { r.isDefault = false; } }); }
		}
		if (body.active !== undefined) { record.active = body.active !== false; }
		if (body.notes !== undefined) { record.notes = String(body.notes); }
		if (body.codes !== undefined) { record.codes = String(body.codes); }
		record.updatedAt = nowIso();
		save(PRICE_LEVELS_KEY, rows);
		return json(record);
	}

	if (idMatch && verb === 'DELETE') {
		const id = Number(idMatch[1]);
		const next = rows.filter(r => r.id !== id);
		save(PRICE_LEVELS_KEY, next);
		return json(undefined, 200);
	}

	return json({ message: 'Unsupported price-level request' }, 405);
}

// ---------------- Fee Sheets ----------------

function feeSheetTotal(items: Array<Record<string, unknown>>): number {
	return (items || []).reduce((sum, it) => {
		const price = Number(it.price ?? it.fee ?? 0) || 0;
		const qty = Number(it.qty ?? it.units ?? 1) || 1;
		return sum + price * qty;
	}, 0);
}

function handleFeeSheets(path: string, options?: RequestInit): Response {
	const rows = load<FeeSheetRecord>(FEE_SHEETS_KEY);
	const verb = method(options);

	if (path === '/api/fee-sheets' && verb === 'GET') {
		return json([...rows].sort((a, b) => b.id - a.id));
	}

	const encMatch = /^\/api\/fee-sheets\/encounter\/([^/]+)$/.exec(path);
	if (encMatch && verb === 'GET') {
		const encounterId = decodeURIComponent(encMatch[1]);
		const match = [...rows].reverse().find(r => r.encounterId === encounterId);
		return json(match ?? null);
	}

	if (path === '/api/fee-sheets' && verb === 'POST') {
		const body = parseBody(options);
		const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
		const record: FeeSheetRecord = {
			id: nextId(rows),
			encounterId: strOrNull(body.encounterId),
			patientId: strOrNull(body.patientId),
			patientName: strOrNull(body.patientName),
			priceLevel: strOrNull(body.priceLevel),
			renderingProvider: strOrNull(body.renderingProvider),
			supervisingProvider: strOrNull(body.supervisingProvider),
			total: notNil(body.total) ? Number(body.total) || 0 : feeSheetTotal(items),
			totalPaid: 0,
			billingStatus: 'Unbilled',
			billedMode: 'cash',
			paymentStatus: 'None',
			items,
			encounterDate: nowIso().slice(0, 10),
			createdAt: nowIso(),
			updatedAt: nowIso(),
		};
		rows.push(record);
		save(FEE_SHEETS_KEY, rows);
		return json(record);
	}

	const idMatch = /^\/api\/fee-sheets\/([^/]+)$/.exec(path);
	if (idMatch && verb === 'PUT') {
		const id = Number(idMatch[1]);
		const record = rows.find(r => r.id === id);
		if (!record) { return json({ message: 'Fee sheet not found' }, 404); }
		const body = parseBody(options);
		if (body.encounterId !== undefined) { record.encounterId = strOrNull(body.encounterId); }
		if (body.patientId !== undefined) { record.patientId = strOrNull(body.patientId); }
		if (body.patientName !== undefined) { record.patientName = strOrNull(body.patientName); }
		if (body.priceLevel !== undefined) { record.priceLevel = strOrNull(body.priceLevel); }
		if (body.renderingProvider !== undefined) { record.renderingProvider = strOrNull(body.renderingProvider); }
		if (body.supervisingProvider !== undefined) { record.supervisingProvider = strOrNull(body.supervisingProvider); }
		if (body.items !== undefined) {
			const items = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
			record.items = items;
			record.total = notNil(body.total) ? Number(body.total) || 0 : feeSheetTotal(items);
		} else if (body.total !== undefined) {
			record.total = Number(body.total) || 0;
		}
		record.updatedAt = nowIso();
		save(FEE_SHEETS_KEY, rows);
		return json(record);
	}

	const billMatch = /^\/api\/fee-sheets\/([^/]+)\/bill$/.exec(path);
	if (billMatch && verb === 'POST') {
		const id = Number(billMatch[1]);
		const record = rows.find(r => r.id === id);
		if (!record) { return json({ message: 'Fee sheet not found' }, 404); }
		record.billingStatus = 'Billed';
		const body = parseBody(options);
		if (notNil(body.billedMode)) { record.billedMode = String(body.billedMode); }
		record.updatedAt = nowIso();
		save(FEE_SHEETS_KEY, rows);
		return json({ success: true, message: 'Fee sheet sent to billing', data: record });
	}

	return json({ message: 'Unsupported fee-sheet request' }, 405);
}

/**
 * Serve Price Level / Fee Sheet routes from local storage. Returns a
 * {@link Response} for handled routes, or `null` to let the caller fall through
 * to the network.
 */
export function tryHandleLocally(path: string, options?: RequestInit): Response | null {
	// Normalise any query string off the path before matching.
	const clean = path.split('?')[0];
	if (clean === '/api/price-levels' || clean.startsWith('/api/price-levels/')) {
		return handlePriceLevels(clean, options);
	}
	if (clean === '/api/fee-sheets' || clean.startsWith('/api/fee-sheets/')) {
		return handleFeeSheets(clean, options);
	}
	return null;
}
