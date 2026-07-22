/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Shared ZIP → City/State auto-fill used by every Ciyex create/edit surface
 * (Settings modules, patient chart forms & dialogs, snapshot modals, credit
 * card forms, clinical drawers…). Typing a complete 5-digit US ZIP resolves
 * the city + state and fills the sibling City/State inputs of the same
 * address group, then freezes them (the ZIP stays the single source of
 * truth); clearing/edited-down ZIPs release the freeze so the fields are
 * hand-editable again. Mirrors the Settings implementation QA asked to roll
 * out app-wide (22-Jul: "this feature already implemented in settings, refer
 * that and implement whole ciyex-workspace").
 */

/** ZIP → { city, state } lookups already resolved this session, so retyping a
 *  ZIP fills instantly and offline. */
const zipLookupCache = new Map<string, { city: string; state: string } | null>();

/** Resolves a 5-digit US ZIP to its city + state via the free Zippopotam
 *  service. Returns null (and caches the miss) when the ZIP is unknown or the
 *  lookup fails — auto-fill is best-effort and never blocks typing. */
export async function lookupZipCityState(zip: string): Promise<{ city: string; state: string } | null> {
	if (zipLookupCache.has(zip)) { return zipLookupCache.get(zip)!; }
	try {
		const res = await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`);
		if (!res.ok) { zipLookupCache.set(zip, null); return null; }
		const j = await res.json().catch(() => null) as { places?: Array<Record<string, string>> } | null;
		const place = j?.places?.[0];
		const hit = place ? { city: place['place name'] || '', state: place['state'] || '' } : null;
		const result = hit && hit.city ? hit : null;
		zipLookupCache.set(zip, result);
		return result;
	} catch {
		return null;
	}
}

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Last key segment, bare alphanumerics, lowercased — for key matching. */
function normalizeSeg(key: string): string {
	return (key.split('.').pop() || key).replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/** Write `value` into a target City/State control and freeze it while the ZIP
 *  owns it. Dispatching `change` keeps custom-dropdown triggers (which mirror
 *  a hidden input) and host form dirty-tracking in sync. */
function applyToTarget(el: FormControl, value: string): void {
	if (!value || !el.isConnected) { return; }
	el.value = value;
	el.dispatchEvent(new Event('change', { bubbles: true }));
	el.dispatchEvent(new Event('input', { bubbles: true }));
	if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
		(el as HTMLInputElement | HTMLTextAreaElement).readOnly = true;
		el.dataset.zipAutoFilled = '1';
		el.style.opacity = '0.75';
	}
}

/** Release any City/State controls a previous ZIP lookup froze. */
function unfreeze(targets: FormControl[]): void {
	for (const el of targets) {
		if (el.dataset.zipAutoFilled === '1' && el.isConnected) {
			(el as HTMLInputElement | HTMLTextAreaElement).readOnly = false;
			el.style.opacity = '';
			delete el.dataset.zipAutoFilled;
		}
	}
}

/**
 * Wire an explicit ZIP input to its City/State inputs (for hand-built forms
 * whose controls aren't registered in a key→input map, e.g. the credit-card
 * billing forms). A complete 5-digit ZIP fills + freezes City/State; an
 * incomplete ZIP releases them.
 */
export function wireZipCityStateInputs(zipEl: HTMLInputElement, cityEl: FormControl | undefined, stateEl: FormControl | undefined): void {
	const targets = [cityEl, stateEl].filter((t): t is FormControl => !!t);
	zipEl.placeholder = 'Enter ZIP — city & state auto-fill';
	zipEl.addEventListener('input', () => {
		const zip = zipEl.value.replace(/\D/g, '').slice(0, 5);
		if (zip.length !== 5) { unfreeze(targets); return; }
		void lookupZipCityState(zip).then(hit => {
			if (!hit || zipEl.value.replace(/\D/g, '').slice(0, 5) !== zip) { return; }
			if (cityEl) { applyToTarget(cityEl, hit.city); }
			if (stateEl) { applyToTarget(stateEl, hit.state); }
		});
	});
}

/**
 * Scan a form's key→control map for ZIP fields and wire each to the
 * City/State controls of the SAME address group (matching key prefix —
 * `guardianZipCode` fills `guardianCity`/`guardianState`; a bare
 * `zip`/`zipCode`/`postalCode` fills the form's plain `city`/`state`). Safe
 * to call on any form: does nothing when no ZIP-shaped key exists.
 */
export function attachZipCityStateAutoFill(inputs: Map<string, FormControl>): void {
	const ZIP_SUFFIXES = ['zipcode', 'postalcode', 'zip'];
	for (const [key, el] of inputs) {
		if (el.tagName !== 'INPUT') { continue; }
		const seg = normalizeSeg(key);
		const suffix = ZIP_SUFFIXES.find(s => seg === s || seg.endsWith(s));
		if (!suffix) { continue; }
		const prefix = seg.slice(0, seg.length - suffix.length);
		const findTarget = (segs: string[]): FormControl | undefined => {
			let fallback: FormControl | undefined;
			for (const [k, inp] of inputs) {
				if (inp === el || inp.tagName === 'TEXTAREA') { continue; }
				const s = normalizeSeg(k);
				if (segs.some(t => s === prefix + t)) { return inp; }
				// Bare city/state as fallback for a prefixed ZIP with no
				// prefixed siblings (single-address forms).
				if (!fallback && segs.includes(s)) { fallback = inp; }
			}
			return fallback;
		};
		wireZipCityStateInputs(el as HTMLInputElement, findTarget(['city', 'town']), findTarget(['state', 'province', 'stateprovince']));
	}
}
