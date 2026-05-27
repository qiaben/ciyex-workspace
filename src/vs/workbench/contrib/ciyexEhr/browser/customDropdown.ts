/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';

/**
 * Shared dropdown / typeahead controls used across every Ciyex create+edit
 * form drawer (tasks, clinical, operations, system, reports, settings…).
 *
 * Native <select> popups are rendered by the OS using its own colour scheme,
 * which on dark workbench themes produces faint grey-on-grey option text —
 * exactly the unreadable dropdown the QA team flagged. These helpers replace
 * native selects + inline typeahead panes with body-mounted popovers that
 * paint with explicit workbench theme colours, so they look right on every
 * theme and never clip behind parent overflow / transforms.
 */

export interface IDropdownOption {
	value: string;
	label: string;
}

export interface ICreateCustomDropdownOptions {
	/** Parent element the visible trigger button is appended to. */
	parent: HTMLElement;
	/** Choices to render inside the popover. */
	options: IDropdownOption[];
	/** Optional starting value — matched against option.value. */
	initialValue?: string;
	/** Placeholder shown in the trigger when no value is selected. */
	placeholder?: string;
	/** Optional CSS for the visible trigger so it matches the host form's input styling. */
	triggerStyle?: string;
	/** Called when the user picks a new option. */
	onChange?: (value: string) => void;
}

interface IThemePalette {
	background: string;
	foreground: string;
	border: string;
	separator: string;
	hoverBackground: string;
	shadow: string;
}

type ThemeKind = 'light' | 'dark' | 'hcLight' | 'hcDark';

const THEME_PALETTES: Record<ThemeKind, IThemePalette> = {
	light: { background: '#ffffff', foreground: '#1f1f1f', border: '#c8c8c8', separator: 'rgba(0,0,0,0.10)', hoverBackground: '#e8e8e8', shadow: 'rgba(0,0,0,0.22)' },
	dark: { background: '#1e1e1e', foreground: '#e6e6e6', border: 'rgba(255,255,255,0.35)', separator: 'rgba(255,255,255,0.12)', hoverBackground: '#37373d', shadow: 'rgba(0,0,0,0.55)' },
	hcLight: { background: '#ffffff', foreground: '#000000', border: '#000000', separator: '#000000', hoverBackground: '#0f4a85', shadow: 'rgba(0,0,0,0.45)' },
	hcDark: { background: '#000000', foreground: '#ffffff', border: '#6fc3df', separator: '#6fc3df', hoverBackground: '#0f4a85', shadow: 'rgba(0,0,0,0.6)' },
};

function detectThemeKind(anchor: HTMLElement | undefined): ThemeKind {
	const classify = (cls: DOMTokenList): ThemeKind | undefined => {
		if (cls.contains('hc-light')) { return 'hcLight'; }
		if (cls.contains('hc-black')) { return 'hcDark'; }
		if (cls.contains('vs-dark')) { return 'dark'; }
		if (cls.contains('vs')) { return 'light'; }
		return undefined;
	};
	let el: HTMLElement | null | undefined = anchor;
	while (el) {
		const kind = classify(el.classList);
		if (kind) { return kind; }
		el = el.parentElement;
	}
	const doc = (anchor && anchor.ownerDocument) || document;
	for (const root of [doc.body, doc.documentElement]) {
		if (root) {
			const kind = classify(root.classList);
			if (kind) { return kind; }
		}
	}
	return 'dark';
}

/**
 * Replacement for `<select>` that returns an HTMLInputElement so existing
 * form code (which stores controls in a Map<…, HTMLInputElement | …> and
 * reads `.value`) keeps working without changes.
 *
 * Renders:
 *   - a hidden <input> appended to `parent` (this is the returned element)
 *   - a visible <button>-styled trigger appended to `parent` after it
 *   - a body-mounted <div> popover containing each option as a clickable row
 *
 * The popover is `position:fixed` against the viewport, so it escapes the
 * host editor's overflow / transform stacking context — that was the source
 * of the "transparent" dropdown the user reported on prescriptions, labs,
 * tasks, recall, and every other create/edit drawer.
 */
export function createCustomDropdown(opts: ICreateCustomDropdownOptions): HTMLInputElement {
	const parent = opts.parent;
	const doc = parent.ownerDocument || document;
	const theme = detectThemeKind(parent);
	const palette = THEME_PALETTES[theme];

	const hidden = doc.createElement('input');
	hidden.type = 'hidden';
	hidden.value = opts.initialValue ?? '';
	parent.appendChild(hidden);

	const inputBg = theme === 'light' || theme === 'hcLight' ? '#ffffff' : '#1e1e1e';

	const trigger = doc.createElement('button');
	trigger.type = 'button';
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', 'false');
	const fallbackStyle = `width:100%;box-sizing:border-box;padding:6px 10px;background:${inputBg};color:${palette.foreground};border:1px solid ${palette.border};border-radius:4px;font-size:13px;cursor:pointer;`;
	trigger.style.cssText = `${opts.triggerStyle || fallbackStyle};display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;font-family:inherit;`;

	const triggerLabel = doc.createElement('span');
	triggerLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
	const triggerCaret = doc.createElement('span');
	// allow-any-unicode-next-line
	triggerCaret.textContent = '▾';
	triggerCaret.style.cssText = 'opacity:0.7;font-size:10px;flex-shrink:0;margin-left:6px;';
	trigger.appendChild(triggerLabel);
	trigger.appendChild(triggerCaret);

	const findLabel = (val: string): string => {
		const match = opts.options.find(o => o.value === val);
		return match ? match.label : (val || opts.placeholder || 'Select...');
	};
	const refreshTriggerLabel = () => {
		const v = hidden.value;
		triggerLabel.textContent = findLabel(v);
		triggerLabel.style.opacity = v ? '1' : '0.6';
	};
	refreshTriggerLabel();

	parent.appendChild(trigger);

	// Body-mounted popover. position:fixed + viewport coordinates so it
	// escapes any overflow:hidden / transform stacking context the host
	// editor sets up.
	const panel = doc.createElement('div');
	panel.className = 'ciyex-custom-dropdown-panel';
	panel.setAttribute('role', 'listbox');
	panel.style.cssText = `position:fixed;background-color:${palette.background};color:${palette.foreground};border:1px solid ${palette.border};border-radius:4px;box-shadow:0 6px 18px ${palette.shadow};z-index:10000;max-height:260px;overflow-y:auto;display:none;`;
	doc.body.appendChild(panel);

	const positionPanel = () => {
		const rect = trigger.getBoundingClientRect();
		panel.style.left = `${rect.left}px`;
		panel.style.top = `${rect.bottom + 2}px`;
		panel.style.minWidth = `${rect.width}px`;
	};
	const renderOptions = () => {
		DOM.clearNode(panel);
		// When a placeholder is supplied, surface it as a "clear" row at the
		// top of the list so the user can reset the selection — this mirrors
		// the original native <select> behaviour where `Select Priority...`
		// appeared as a selectable (empty-value) first option.
		const rows: Array<{ value: string; label: string; placeholder?: boolean }> = [];
		if (opts.placeholder) {
			rows.push({ value: '', label: opts.placeholder, placeholder: true });
		}
		for (const o of opts.options) { rows.push({ value: o.value, label: o.label }); }
		for (const opt of rows) {
			const row = doc.createElement('div');
			row.setAttribute('role', 'option');
			const isSelected = opt.value === hidden.value;
			const extraStyle = opt.placeholder ? 'opacity:0.7;font-style:italic;' : (isSelected ? 'font-weight:500;' : '');
			row.style.cssText = `padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid ${palette.separator};background-color:${isSelected ? palette.hoverBackground : palette.background};color:${palette.foreground};${extraStyle}`;
			row.textContent = opt.label;
			row.addEventListener('mouseenter', () => { row.style.backgroundColor = palette.hoverBackground; });
			row.addEventListener('mouseleave', () => { row.style.backgroundColor = opt.value === hidden.value ? palette.hoverBackground : palette.background; });
			row.addEventListener('mousedown', (e) => {
				e.preventDefault();
				const prev = hidden.value;
				hidden.value = opt.value;
				refreshTriggerLabel();
				closePanel();
				if (prev !== opt.value) {
					// Fire 'change' so existing listeners on the (formerly select)
					// element pick up the new value.
					hidden.dispatchEvent(new Event('change', { bubbles: true }));
					if (opts.onChange) { opts.onChange(opt.value); }
				}
			});
			panel.appendChild(row);
		}
	};
	let panelOpen = false;
	const openPanel = () => {
		renderOptions();
		positionPanel();
		panel.style.display = 'block';
		trigger.setAttribute('aria-expanded', 'true');
		panelOpen = true;
	};
	const closePanel = () => {
		panel.style.display = 'none';
		trigger.setAttribute('aria-expanded', 'false');
		panelOpen = false;
	};
	trigger.addEventListener('click', (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (panelOpen) { closePanel(); } else { openPanel(); }
	});
	trigger.addEventListener('focus', () => { trigger.style.outline = `1px solid var(--vscode-focusBorder, #007fd4)`; trigger.style.outlineOffset = '-1px'; });
	trigger.addEventListener('blur', () => { trigger.style.outline = 'none'; });

	const onDocClick = (e: MouseEvent) => {
		if (!panelOpen) { return; }
		const target = e.target as Node | null;
		if (target && (panel.contains(target) || trigger.contains(target))) { return; }
		closePanel();
	};
	doc.addEventListener('mousedown', onDocClick, true);
	const reposition = () => { if (panelOpen) { positionPanel(); } };
	const win = doc.defaultView;
	win?.addEventListener('scroll', reposition, true);
	win?.addEventListener('resize', reposition);

	// Auto-cleanup once the trigger is detached from the DOM (the host
	// dialog has been closed). MutationObserver on the trigger's parent
	// catches this without requiring callers to wire explicit lifecycle.
	const cleanup = () => {
		doc.removeEventListener('mousedown', onDocClick, true);
		win?.removeEventListener('scroll', reposition, true);
		win?.removeEventListener('resize', reposition);
		if (panel.parentElement) { panel.parentElement.removeChild(panel); }
	};
	const observer = new MutationObserver(() => {
		if (!trigger.isConnected) {
			observer.disconnect();
			cleanup();
		}
	});
	if (trigger.parentNode) { observer.observe(trigger.parentNode, { childList: true, subtree: true }); }

	// Mirror value writes from external callers (e.g. form-reset code that
	// does `inputs.get(key).value = ''`) back into the visible trigger.
	// HTMLInputElement.value is implemented via a property setter on the
	// prototype — we override it on this specific instance so the visible
	// trigger label updates whenever the value changes from outside.
	const proto = Object.getPrototypeOf(hidden);
	const desc = Object.getOwnPropertyDescriptor(proto, 'value');
	if (desc && desc.set && desc.get) {
		Object.defineProperty(hidden, 'value', {
			configurable: true,
			get() { return desc.get!.call(hidden); },
			set(v: string) { desc.set!.call(hidden, v); refreshTriggerLabel(); },
		});
	}

	// Keep the trigger reachable via the hidden input so callers that style
	// the "input" for validation (e.g. setting borderColor on the inputs
	// map entry) can find the visible element. Exposed as a non-enumerable
	// property to avoid surprising serialisation.
	Object.defineProperty(hidden, 'ciyexDropdownTrigger', { value: trigger, enumerable: false });

	// Mirror `disabled` writes on the hidden input to the visible trigger.
	// Form code that previously did `select.disabled = true` to grey out a
	// read-only dropdown now affects the visible UI without callers having
	// to know about the trigger button.
	const protoDisabled = Object.getOwnPropertyDescriptor(proto, 'disabled');
	if (protoDisabled && protoDisabled.set && protoDisabled.get) {
		Object.defineProperty(hidden, 'disabled', {
			configurable: true,
			get() { return protoDisabled.get!.call(hidden); },
			set(v: boolean) {
				protoDisabled.set!.call(hidden, v);
				trigger.disabled = !!v;
				trigger.style.opacity = v ? '0.55' : '1';
				trigger.style.cursor = v ? 'not-allowed' : 'pointer';
			},
		});
	}

	return hidden;
}
