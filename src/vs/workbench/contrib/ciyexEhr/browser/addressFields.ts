/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Canonical Address Line 1 / Address Line 2 / City / State / ZIP Code field
 * group shared by every create/edit form in the app (27-Jul: "instead of one
 * address field I need this fields in all the places"). Single source of
 * truth for the labels, placeholders and key names so every screen matches;
 * the ZIP auto-fill behaviour itself stays in {@link ./zipAutoFill.ts}.
 */

type AddressKey = 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'zip';

export const ADDRESS_LABELS: Record<AddressKey, string> = {
	addressLine1: 'Address Line 1',
	addressLine2: 'Address Line 2',
	city: 'City',
	state: 'State',
	zip: 'ZIP Code',
};

export const ADDRESS_PLACEHOLDERS: Record<AddressKey, string> = {
	addressLine1: 'Street address',
	addressLine2: 'Suite, unit, building, floor, etc.',
	city: 'City',
	state: 'State / Province',
	zip: 'Enter ZIP — city & state auto-fill',
};

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build the 5 canonical address field configs (key/label/type/placeholder)
 * for a declarative field-config array consumed by a generic form renderer.
 * `keyPrefix` namespaces the keys for a sub-address (e.g. `'guardian'` ->
 * `guardianAddressLine1`); `columns` is the enclosing section's grid column
 * count — pass 2 (the default) for a plain two-column form grid (Line 1 /
 * Line 2 on one row, City / State on the next, ZIP alone on the last —
 * matching the target layout exactly), or 3+ for a wider section grid
 * (full-width Line 1 / Line 2 rows, then City / State / ZIP sharing the
 * final row).
 */
export function buildAddressFieldConfigs(keyPrefix = '', columns = 2): Array<{ key: string; label: string; type: 'text'; placeholder: string; colSpan: number; localOnly: true }> {
	const key = (suffix: string) => keyPrefix ? keyPrefix + capitalize(suffix) : suffix;
	const lineSpan = columns >= 3 ? columns : 1;
	// `localOnly: true` so patientChartEditor's backend tab_field_config merge
	// (which otherwise only renders whatever field KEYS the backend ships)
	// still appends these when the backend row hasn't been migrated to the
	// split shape yet — see the per-tab legacy-key strip in patientChartEditor.ts.
	return [
		{ key: key('addressLine1'), label: ADDRESS_LABELS.addressLine1, type: 'text', placeholder: ADDRESS_PLACEHOLDERS.addressLine1, colSpan: lineSpan, localOnly: true },
		{ key: key('addressLine2'), label: ADDRESS_LABELS.addressLine2, type: 'text', placeholder: ADDRESS_PLACEHOLDERS.addressLine2, colSpan: lineSpan, localOnly: true },
		{ key: key('city'), label: ADDRESS_LABELS.city, type: 'text', placeholder: ADDRESS_PLACEHOLDERS.city, colSpan: 1, localOnly: true },
		{ key: key('state'), label: ADDRESS_LABELS.state, type: 'text', placeholder: ADDRESS_PLACEHOLDERS.state, colSpan: 1, localOnly: true },
		{ key: key('zip'), label: ADDRESS_LABELS.zip, type: 'text', placeholder: ADDRESS_PLACEHOLDERS.zip, colSpan: 1, localOnly: true },
	];
}
