/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { wireZipCityStateInputs } from './zipAutoFill.js';

/**
 * Shared address control: every place the app captures an address renders the
 * same five inputs — Address Line 1 / Address Line 2 / ZIP Code / City / State
 * — with the Settings page's ZIP auto-fill behaviour (a complete 5-digit ZIP
 * resolves City + State and freezes them). QA 27-Jul: "wherever the address
 * will be there it will come address1, address2, state, city, zipcode, example
 * like the settings page… and if we enter zipcode the city, state will
 * automatically fetch".
 *
 * Forms keep a single control per field key, so the group registers ONE hidden
 * input under the field's own key and keeps its value in sync with the visible
 * parts. Two persistence shapes are supported:
 *
 *  - `map`    — the value is the `{ line1, line2, city, state, zip }` object the
 *               backend's `type: "address"` FHIR mapping reads and writes
 *               (patient demographics `Patient.address[0]`). The hidden input
 *               carries the JSON and is flagged with `data-value-json`, so save
 *               paths post an object instead of a string (see `readControlValue`).
 *  - `string` — the value is a single line ("123 Main St, Apt 2, Springfield,
 *               IL 62704") for the address fields the backend stores as a plain
 *               string extension (guardian / pharmacy / guarantor / employer
 *               address, related person, supplier…). The shape on the wire is
 *               unchanged — only the way it is captured and displayed.
 */

export type AddressValueFormat = 'map' | 'string';

/** The five parts of a US address, in the order the group renders them. */
export interface IAddressParts {
	line1: string;
	line2: string;
	zip: string;
	city: string;
	state: string;
}

const EMPTY_PARTS: IAddressParts = { line1: '', line2: '', zip: '', city: '', state: '' };

/**
 * True when the field should render as an address group: the backend's
 * structured `address` type, or a plain text/textarea field whose key names a
 * postal address (`address`, `guardianAddress`, `pharmacy_address`…). Keys that
 * merely end in "address" without being one (email / IP / web) are excluded, and
 * so are forms that already split the address themselves (`addressLine1`).
 */
export function isAddressField(type: string | undefined, key: string): boolean {
	const t = (type || '').toLowerCase();
	if (t === 'address') { return true; }
	if (t && t !== 'text' && t !== 'textarea') { return false; }
	// camelCase → snake so `guardianAddress` and `guardian_address` both split.
	const seg = (key || '').trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
	if (/(email|mail|ip|url|web|site|mac|wallet)[_.-]?address$/.test(seg)) { return false; }
	return seg === 'address' || /[_.-]address$/.test(seg);
}

/** Split a one-line address back into its parts (round-trips `joinParts`). */
export function parseAddressString(raw: string): IAddressParts {
	const parts = { ...EMPTY_PARTS };
	const segs = (raw || '').split(',').map(s => s.trim()).filter(Boolean);
	if (segs.length === 0) { return parts; }
	// Work backwards: the tail is "STATE ZIP", "ZIP" or "STATE".
	const tail = segs[segs.length - 1];
	const stateZip = /^([A-Za-z][A-Za-z .]*?)\s+(\d{5}(?:-\d{4})?)$/.exec(tail);
	if (stateZip) {
		parts.state = stateZip[1].trim();
		parts.zip = stateZip[2];
		segs.pop();
	} else if (/^\d{5}(?:-\d{4})?$/.test(tail)) {
		parts.zip = tail;
		segs.pop();
	} else if (segs.length >= 3) {
		parts.state = tail;
		segs.pop();
	}
	if (segs.length >= 2) { parts.city = segs.pop() || ''; }
	parts.line1 = segs.shift() || '';
	parts.line2 = segs.join(', ');
	return parts;
}

/** Read an existing value of any supported shape into address parts. */
export function toAddressParts(value: unknown): IAddressParts {
	if (!value) { return { ...EMPTY_PARTS }; }
	if (typeof value === 'string') {
		const text = value.trim();
		if (text.startsWith('{')) {
			try { return toAddressParts(JSON.parse(text)); } catch { /* not JSON — treat as a plain line */ }
		}
		return parseAddressString(text);
	}
	if (typeof value !== 'object') { return { ...EMPTY_PARTS }; }
	const v = value as Record<string, unknown>;
	// FHIR Address ({ line: [l1, l2], city, state, postalCode }) and the
	// backend's flattened map ({ line1, line2, city, state, zip }).
	const line = Array.isArray(v.line) ? v.line.map(l => String(l ?? '')) : [];
	const str = (x: unknown): string => (x === null || x === undefined) ? '' : String(x);
	return {
		line1: str(v.line1 ?? v.addressLine1 ?? line[0] ?? v.street ?? ''),
		line2: str(v.line2 ?? v.addressLine2 ?? line[1] ?? ''),
		zip: str(v.zip ?? v.postalCode ?? v.zipCode ?? v.zipcode ?? ''),
		city: str(v.city ?? v.town ?? ''),
		state: str(v.state ?? v.province ?? ''),
	};
}

/** Compose the parts into the one-line form used by string-valued addresses. */
export function joinParts(p: IAddressParts): string {
	const stateZip = [p.state.trim(), p.zip.trim()].filter(Boolean).join(' ');
	return [p.line1.trim(), p.line2.trim(), p.city.trim(), stateZip].filter(Boolean).join(', ');
}

/** True when the control holds a JSON object value rather than plain text. */
export function isJsonValueControl(el: Element): boolean {
	return DOM.isHTMLInputElement(el) && el.dataset.valueJson === '1';
}

/**
 * Value to post for a form control: the parsed object for JSON-valued controls
 * (address groups), the raw string for everything else. Save paths call this
 * instead of reading `.value` directly so an address reaches the backend in the
 * `{ line1, line2, city, state, zip }` shape its FHIR mapping expects.
 */
export function readControlValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): unknown {
	if (isJsonValueControl(el)) {
		try {
			const parsed = JSON.parse(el.value || '{}') as Record<string, unknown>;
			return Object.values(parsed).some(v => String(v ?? '').trim()) ? parsed : '';
		} catch {
			return '';
		}
	}
	return el.value;
}

/**
 * Which parts the group should render for `key`, given the other field keys of
 * the same form. Forms that already carry their own City / State / ZIP inputs
 * (facilities, organizations…) only get Line 1 + Line 2 here, so the address
 * still reads Line 1 / Line 2 / City / State / ZIP without duplicate inputs —
 * their ZIP is wired to City/State by `attachZipCityStateAutoFill`.
 */
export function addressPartsFor(key: string, siblingKeys: Iterable<string>): Array<keyof IAddressParts> {
	const norm = (k: string): string => (k.split('.').pop() || k).replace(/[^a-z0-9]/gi, '').toLowerCase();
	const seg = norm(key);
	const prefix = seg.endsWith('address') ? seg.slice(0, seg.length - 'address'.length) : '';
	const siblings = new Set<string>();
	for (const k of siblingKeys) { if (norm(k) !== seg) { siblings.add(norm(k)); } }
	const has = (names: string[]): boolean => names.some(n => siblings.has(prefix + n) || (!prefix && siblings.has(n)));
	const parts: Array<keyof IAddressParts> = ['line1', 'line2'];
	if (!has(['zip', 'zipcode', 'postalcode'])) { parts.push('zip'); }
	if (!has(['city', 'town'])) { parts.push('city'); }
	if (!has(['state', 'province', 'stateprovince'])) { parts.push('state'); }
	return parts;
}

export interface IAddressGroupOptions {
	/** Cell the group is rendered into (the field's own grid cell). */
	parent: HTMLElement;
	/** Existing value — object, JSON string or one-line string. */
	value: unknown;
	/** Wire shape for the composed value. */
	format: AddressValueFormat;
	/** Input style of the host form, so the parts look like every other field. */
	inputStyle: string;
	/** Style for the small part captions ("Address Line 1", "City", …). */
	captionStyle?: string;
	/** Marks the group read-only (view mode). */
	readOnly?: boolean;
	/** Parts to render — defaults to all five. See `addressPartsFor`. */
	parts?: Array<keyof IAddressParts>;
}

const PART_DEFS: Array<{ key: keyof IAddressParts; caption: string; placeholder: string; span: 1 | 2 }> = [
	{ key: 'line1', caption: 'Address Line 1', placeholder: 'Street address', span: 2 },
	{ key: 'line2', caption: 'Address Line 2', placeholder: 'Apt, suite, unit (optional)', span: 2 },
	{ key: 'zip', caption: 'ZIP Code', placeholder: 'Enter ZIP — city & state auto-fill', span: 1 },
	{ key: 'city', caption: 'City', placeholder: 'City', span: 1 },
	{ key: 'state', caption: 'State', placeholder: 'State', span: 1 },
];

/**
 * Render the five address inputs into `parent` and return the hidden control
 * the host form should register under the field's key. The hidden control's
 * value tracks every keystroke, so existing seed (`el.value = …`) and save
 * (`el.value`) paths keep working; seeding it with a new value re-populates
 * the visible parts.
 */
export function createAddressGroup(opts: IAddressGroupOptions): HTMLInputElement {
	const rendered = new Set<keyof IAddressParts>(opts.parts || PART_DEFS.map(d => d.key));
	// Parts the host form renders itself (its own City/State/ZIP inputs) are
	// carried here untouched so an existing value never gets dropped on save.
	const carried = toAddressParts(opts.value);

	const grid = DOM.append(opts.parent, DOM.$('div'));
	grid.style.cssText = 'display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px 10px;';

	const hidden = DOM.append(opts.parent, DOM.$('input')) as HTMLInputElement;
	hidden.type = 'text';
	hidden.style.cssText = 'display:none;';
	if (opts.format === 'map') { hidden.dataset.valueJson = '1'; }

	const inputs = new Map<keyof IAddressParts, HTMLInputElement>();
	const currentParts = (): IAddressParts => {
		const out = { ...carried };
		for (const [key, el] of inputs) { out[key] = el.value; }
		return out;
	};
	const sync = (): void => {
		const current = currentParts();
		hidden.value = opts.format === 'map'
			? (joinParts(current) ? JSON.stringify({ line1: current.line1, line2: current.line2, city: current.city, state: current.state, zip: current.zip }) : '')
			: joinParts(current);
	};

	const captionStyle = opts.captionStyle || 'display:block;font-size:10px;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
	for (const def of PART_DEFS) {
		if (!rendered.has(def.key)) { continue; }
		const cell = DOM.append(grid, DOM.$('div'));
		cell.style.cssText = def.span === 2 ? 'grid-column:span 2;' : '';
		const cap = DOM.append(cell, DOM.$('span'));
		cap.textContent = def.caption;
		cap.style.cssText = captionStyle;
		const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
		inp.type = 'text';
		inp.value = carried[def.key];
		inp.placeholder = def.placeholder;
		inp.style.cssText = opts.inputStyle;
		if (opts.readOnly) { inp.readOnly = true; }
		inp.addEventListener('input', sync);
		inp.addEventListener('change', sync);
		inputs.set(def.key, inp);
	}

	// Same ZIP → City/State behaviour as the Settings address forms.
	const zipEl = inputs.get('zip');
	if (zipEl) { wireZipCityStateInputs(zipEl, inputs.get('city'), inputs.get('state')); }

	sync();

	// Re-seeding the hidden control (edit dialogs assign `el.value = record[key]`
	// after render) repaints the visible parts.
	const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
	if (proto?.get && proto.set) {
		const nativeGet = proto.get, nativeSet = proto.set;
		Object.defineProperty(hidden, 'value', {
			configurable: true,
			get(): string { return nativeGet.call(hidden); },
			set(next: string): void {
				nativeSet.call(hidden, next ?? '');
				const seeded = toAddressParts(next);
				// Only repaint when the assignment didn't come from `sync()`.
				if (joinParts(seeded) === joinParts(currentParts())) { return; }
				for (const [key, el] of inputs) { el.value = seeded[key]; }
				for (const key of Object.keys(carried) as Array<keyof IAddressParts>) {
					if (!inputs.has(key)) { carried[key] = seeded[key]; }
				}
			},
		});
	}

	return hidden;
}
