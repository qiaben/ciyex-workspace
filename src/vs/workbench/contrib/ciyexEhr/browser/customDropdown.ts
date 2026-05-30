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

// Every visible surface uses a workbench CSS variable with a sensible
// fallback. We deliberately don't detect the theme up-front and pick from a
// fixed palette — that approach broke on the clinical / operations / system
// menu drawers when the workbench was light but the detection fell back to
// 'dark', producing a dark popover on a light page. CSS variables follow
// whichever theme is active so the popover matches the rest of the
// workbench on every theme without us having to detect it.
const COLORS = {
	background: 'var(--vscode-editorWidget-background, var(--vscode-dropdown-background, var(--vscode-input-background, #1e1e1e)))',
	foreground: 'var(--vscode-foreground, #cccccc)',
	border: 'var(--vscode-widget-border, var(--vscode-editorWidget-border, var(--vscode-input-border, rgba(127,127,127,0.4))))',
	separator: 'var(--vscode-editorWidget-border, rgba(128,128,128,0.2))',
	hoverBackground: 'var(--vscode-list-hoverBackground, rgba(128,128,128,0.16))',
	triggerBackground: 'var(--vscode-input-background, #1e1e1e)',
	triggerBorder: 'var(--vscode-input-border, rgba(127,127,127,0.4))',
	// The shadow stays palette-driven because it deepens on dark themes
	// for legibility; on light themes a softer alpha looks more natural.
	shadow: 'rgba(0,0,0,0.35)',
};

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
/**
 * Walk up from `anchor` until we find the workbench root (the element
 * VS Code stamps with the `monaco-workbench` class). All workbench theme
 * CSS variables (`--vscode-foreground`, `--vscode-input-background`,
 * `--vscode-editorWidget-background`, …) are scoped under that selector,
 * so the popover has to be mounted inside it for those vars to resolve
 * to the active theme. Mounting on `document.body` instead made every
 * var fall back to the dark default, producing the dark dropdown over
 * a light workbench QA flagged.
 */
export function findWorkbenchRoot(anchor: HTMLElement, doc: Document): HTMLElement {
	// First: walk up from the anchor.
	// Skip position:fixed overlays (e.g. the EHR form drawer that copies the
	// monaco-workbench class for CSS-var inheritance). The real workbench root
	// has position:relative from its class styles, never position:fixed as an
	// inline override — mounting panels inside a fixed overlay puts them in a
	// stacking context where VS Code's own class rules may hide them.
	let el: HTMLElement | null = anchor;
	while (el) {
		if (el.classList && el.classList.contains('monaco-workbench') && el.style.position !== 'fixed') { return el; }
		el = el.parentElement;
	}
	// Fallback: query for the workbench root by class — VS Code itself
	// uses this exact lookup in layout.ts. The alternative (body mount)
	// leaves the popover outside `.monaco-workbench` where the workbench
	// CSS variables aren't defined, so light themes render dark popovers.
	// eslint-disable-next-line no-restricted-syntax
	const wb = (doc.body || doc.documentElement).getElementsByClassName('monaco-workbench')[0] as HTMLElement | undefined;
	if (wb) { return wb; }
	return doc.body || doc.documentElement;
}

export function createCustomDropdown(opts: ICreateCustomDropdownOptions): HTMLInputElement {
	const parent = opts.parent;
	const doc = parent.ownerDocument || document;
	const workbenchRoot = findWorkbenchRoot(parent, doc);

	const hidden = doc.createElement('input');
	hidden.type = 'hidden';
	hidden.value = opts.initialValue ?? '';
	parent.appendChild(hidden);

	const trigger = doc.createElement('button');
	trigger.type = 'button';
	trigger.setAttribute('aria-haspopup', 'listbox');
	trigger.setAttribute('aria-expanded', 'false');
	const fallbackStyle = `width:100%;box-sizing:border-box;padding:6px 10px;background:${COLORS.triggerBackground};color:${COLORS.foreground};border:1px solid ${COLORS.triggerBorder};border-radius:4px;font-size:13px;cursor:pointer;`;
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
	// Add monaco-workbench class so --vscode-* CSS variables resolve to the
	// active theme even though the panel is mounted on document.body (outside
	// the real workbench root). Mounting on body is required because VS Code
	// applies transform + overflow:hidden to .monaco-workbench, which makes
	// position:fixed children use it as their containing block and clips them.
	panel.className = 'ciyex-custom-dropdown-panel monaco-workbench';
	panel.setAttribute('role', 'listbox');
	panel.style.cssText = `position:fixed;background-color:${COLORS.background};color:${COLORS.foreground};border:1px solid ${COLORS.border};border-radius:4px;box-shadow:0 6px 18px ${COLORS.shadow};z-index:10000;max-height:260px;overflow-y:auto;display:none;`;
	(doc.body || doc.documentElement).appendChild(panel);

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
			row.style.cssText = `padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid ${COLORS.separator};background-color:${isSelected ? COLORS.hoverBackground : COLORS.background};color:${COLORS.foreground};${extraStyle}`;
			row.textContent = opt.label;
			row.addEventListener('mouseenter', () => { row.style.backgroundColor = COLORS.hoverBackground; });
			row.addEventListener('mouseleave', () => { row.style.backgroundColor = opt.value === hidden.value ? COLORS.hoverBackground : COLORS.background; });
			row.addEventListener('mousedown', (e) => {
				e.preventDefault();
				// Keep the selection contained to this control. Without this the
				// mousedown also reaches the host form's outside-click / backdrop
				// handlers.
				e.stopPropagation();
				const prev = hidden.value;
				hidden.value = opt.value;
				refreshTriggerLabel();
				closePanel();
				// closePanel() hides this body-mounted panel during the mousedown,
				// so the browser then dispatches a synthetic `click` whose target —
				// the panel now being display:none — resolves to whatever sits
				// underneath (the host form's overlay scrim / backdrop). That stray
				// click was tearing the create/edit drawer down before the user
				// could save. Swallow exactly that one trailing click.
				const swallowNextClick = (ev: Event) => {
					ev.stopPropagation();
					ev.preventDefault();
					doc.removeEventListener('click', swallowNextClick, true);
				};
				doc.addEventListener('click', swallowNextClick, true);
				// Fallback: if no click is generated (e.g. the pointer was dragged
				// off the row) drop the listener so it can't swallow a later click.
				doc.defaultView?.setTimeout(() => doc.removeEventListener('click', swallowNextClick, true), 100);
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
		if (!panel.isConnected) {
			(doc.body || doc.documentElement).appendChild(panel);
		}
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
