/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Format raw user input as a US date mask (MM/DD/YYYY). Strips non-digits,
 * caps at 8 digits (MMDDYYYY so the year stays 4 digits), and auto-inserts the
 * `/` separators. Used by the manually-typed date fields so typing "06122004"
 * becomes "06/12/2004" instead of leaving the slashes out or letting the year
 * grow past 4 digits.
 */
export function maskUsDate(raw: string): string {
	const d = raw.replace(/\D/g, '').slice(0, 8);
	if (d.length <= 2) { return d; }
	if (d.length <= 4) { return `${d.slice(0, 2)}/${d.slice(2)}`; }
	return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Convert an ISO date (yyyy-mm-dd, possibly with a time suffix) to MM/DD/YYYY. */
export function isoToUsDate(iso: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
	return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}

/** Convert a MM/DD/YYYY string to an ISO date (yyyy-mm-dd). Returns '' if incomplete. */
export function usToIsoDate(us: string): string {
	const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us);
	if (!m) { return ''; }
	return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/**
 * Build a US-format (MM/DD/YYYY) masked date field: a visible text input that
 * auto-inserts slashes and caps the year at 4 digits (via {@link maskUsDate}),
 * a hidden input that always holds the ISO value the backend expects, and a
 * transparent native picker overlaid on a calendar icon. Native
 * `<input type="date">` renders in OS-locale order on Linux Electron and lets
 * the year grow past 4 digits, so manually-typed date fields use this instead.
 *
 * Returns the parts; the caller mounts nothing else — the field is appended to
 * `container`. The value-bearing element is `hidden` (ISO yyyy-mm-dd).
 */
export function createUsDateField(
	doc: Document,
	container: HTMLElement,
	isoValue: string,
	inputCss: string,
	iconColor: string = 'var(--vscode-descriptionForeground)'
): { hidden: HTMLInputElement; visible: HTMLInputElement; picker: HTMLInputElement } {
	const wrap = doc.createElement('div');
	wrap.style.cssText = 'position:relative;display:block;width:100%;';

	const visible = doc.createElement('input');
	visible.type = 'text';
	visible.placeholder = 'MM/DD/YYYY';
	visible.maxLength = 10;
	visible.value = isoToUsDate(isoValue);
	visible.style.cssText = inputCss + 'padding-right:30px;';

	const hidden = doc.createElement('input');
	hidden.type = 'hidden';
	hidden.value = isoValue || '';

	const sync = () => {
		const masked = maskUsDate(visible.value);
		if (masked !== visible.value) { visible.value = masked; }
		const iso = usToIsoDate(visible.value);
		hidden.value = iso;
		visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
	};
	visible.addEventListener('input', sync);
	visible.addEventListener('blur', sync);

	const picker = doc.createElement('input');
	picker.type = 'date';
	picker.title = 'Open calendar';
	picker.value = isoValue || '';
	picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
	picker.addEventListener('change', () => {
		visible.value = isoToUsDate(picker.value);
		hidden.value = picker.value;
	});

	const icon = doc.createElement('span');
	icon.textContent = '\u{1F4C5}';
	icon.style.cssText = `position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:14px;color:${iconColor};pointer-events:none;line-height:1;`;

	wrap.appendChild(visible);
	wrap.appendChild(hidden);
	wrap.appendChild(picker);
	wrap.appendChild(icon);
	container.appendChild(wrap);
	return { hidden, visible, picker };
}
