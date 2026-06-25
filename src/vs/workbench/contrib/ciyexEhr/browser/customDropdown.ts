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
	// A genuine workbench root has the `monaco-workbench` class but is NOT one of
	// the body-mounted popovers we inject (custom dropdown / search panels), which
	// also copy that class for CSS-var inheritance and are rendered `position:fixed`.
	// Two reasons to skip them:
	//  1. The EHR form drawer / dropdown overlays are `position:fixed`; mounting
	//     panels inside such a fixed overlay puts them in a stacking context where
	//     VS Code's own class rules may hide them.
	//  2. Those injected panels accumulate in the DOM, so a naive
	//     `getElementsByClassName('monaco-workbench')[0]` lookup can return a
	//     stale, zero-size panel that sits before the real workbench in document
	//     order — anything mounted inside it is then invisible (the "Approve
	//     Authorization" modal never appeared because showThemedModal appended it
	//     into a leftover dropdown panel).
	const isInjectedPanel = (e: Element): boolean =>
		e.classList.contains('ciyex-custom-dropdown-panel') || e.classList.contains('ciyex-search-dropdown');
	let el: HTMLElement | null = anchor;
	while (el) {
		if (el.classList && el.classList.contains('monaco-workbench') && el.style.position !== 'fixed' && !isInjectedPanel(el)) { return el; }
		el = el.parentElement;
	}
	// Fallback: query for the workbench root by class — VS Code itself
	// uses this exact lookup in layout.ts. The alternative (body mount)
	// leaves the popover outside `.monaco-workbench` where the workbench
	// CSS variables aren't defined, so light themes render dark popovers.
	// Skip our own injected panels so we return the actual workbench shell.
	// eslint-disable-next-line no-restricted-syntax
	const candidates = (doc.body || doc.documentElement).getElementsByClassName('monaco-workbench');
	for (let i = 0; i < candidates.length; i++) {
		const cand = candidates[i] as HTMLElement;
		if (!isInjectedPanel(cand) && cand.style.position !== 'fixed') { return cand; }
	}
	return doc.body || doc.documentElement;
}

export function createCustomDropdown(opts: ICreateCustomDropdownOptions): HTMLInputElement {
	const parent = opts.parent;
	const doc = parent.ownerDocument || document;

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
	// Allow callers that set `hidden.value` programmatically to refresh the
	// visible trigger label by dispatching a `change` event on the hidden input.
	hidden.addEventListener('change', refreshTriggerLabel);

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
	// font-family is set explicitly: the panel is mounted on document.body
	// (outside the editor's font scope) so without it the option rows fall back
	// to the browser default serif at an inconsistent size — that was the
	// "big & uneven" dropdown the QA team flagged. Pin it to the workbench font
	// so options match the trigger (which inherits it) exactly.
	// `right:auto;bottom:auto` are set explicitly because the panel copies the
	// `monaco-workbench` class (for theme-var inheritance) and that class applies
	// `inset:0`. Without overriding right/bottom, the fixed-position panel would
	// stretch from its `left` all the way to the viewport's right edge — the
	// "dropdown covers too much space / huge width" the QA team flagged on every
	// create+edit form (gender, priority, status, provider, location, expiry, …).
	panel.style.cssText = `position:fixed;right:auto;bottom:auto;box-sizing:border-box;background-color:${COLORS.background};color:${COLORS.foreground};border:1px solid ${COLORS.border};border-radius:6px;box-shadow:0 6px 18px ${COLORS.shadow};z-index:10000;max-height:320px;overflow-y:auto;display:none;padding:4px;font-family:var(--vscode-font-family, system-ui, sans-serif);font-size:13px;`;
	(doc.body || doc.documentElement).appendChild(panel);

	const positionPanel = () => {
		const rect = trigger.getBoundingClientRect();
		panel.style.left = `${rect.left}px`;
		// Clamp the panel to the available viewport space and flip it above the
		// trigger when there isn't enough room below. Without this, a trigger that
		// sits low in the viewport (e.g. Category/Location/Supplier — the last
		// fields in the New Inventory form) pushes the up-to-320px panel off the
		// bottom of the screen, hiding the lower options with no way to scroll to
		// them. With overflow-y:auto already on the panel, clamping max-height keeps
		// every option reachable.
		const view = doc.defaultView;
		const vh = (view?.innerHeight) || doc.documentElement.clientHeight;
		const gap = 2;
		const margin = 8;
		const desired = 320;
		const spaceBelow = vh - rect.bottom - margin;
		const spaceAbove = rect.top - margin;
		if (spaceBelow >= Math.min(desired, 160) || spaceBelow >= spaceAbove) {
			panel.style.top = `${rect.bottom + gap}px`;
			panel.style.bottom = 'auto';
			panel.style.maxHeight = `${Math.max(120, Math.min(desired, spaceBelow))}px`;
		} else {
			panel.style.top = 'auto';
			panel.style.bottom = `${vh - rect.top + gap}px`;
			panel.style.maxHeight = `${Math.max(120, Math.min(desired, spaceAbove))}px`;
		}
		// Match the panel to the trigger width so the popover lines up with the
		// field instead of sprawling across the form. Long option labels are
		// truncated with an ellipsis (rows use white-space:nowrap + text-overflow)
		// rather than widening the panel.
		panel.style.width = `${rect.width}px`;
		panel.style.minWidth = `${rect.width}px`;
		panel.style.maxWidth = `${rect.width}px`;
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
			const extraStyle = opt.placeholder ? 'opacity:0.7;font-style:italic;' : (isSelected ? 'font-weight:600;' : '');
			// Even, compact rows: a fixed line-height keeps every row the same
			// height regardless of glyph ascenders/descenders, a single border
			// radius matches the panel, and hover/selection share one rounded
			// highlight. No per-row border — the previous border-bottom on every
			// row made the list read like a heavy table (QA "uneven look").
			row.style.cssText = `padding:6px 10px;cursor:pointer;font-size:13px;line-height:18px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background-color:${isSelected ? COLORS.hoverBackground : 'transparent'};color:${COLORS.foreground};${extraStyle}`;
			row.textContent = opt.label;
			row.addEventListener('mouseenter', () => { row.style.backgroundColor = COLORS.hoverBackground; });
			row.addEventListener('mouseleave', () => { row.style.backgroundColor = opt.value === hidden.value ? COLORS.hoverBackground : 'transparent'; });
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
	// Observe the whole document subtree, not just `trigger.parentNode`: when the
	// host form drawer is closed the overlay is removed wholesale, so the trigger
	// leaves the DOM via an ANCESTOR removal that never mutates its own parent's
	// childList. The old parent-only observer therefore never fired and the
	// body-mounted panel leaked (orphaned panels piling up behind every
	// create/edit form). The callback only checks `isConnected`, so the broad
	// scope stays cheap.
	const observeRoot = doc.body || doc.documentElement;
	if (observeRoot) { observer.observe(observeRoot, { childList: true, subtree: true }); }

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

export interface ICreateTimeDropdownOptions {
	/** Parent element the visible trigger button is appended to. */
	parent: HTMLElement;
	/** Starting value as 24-hour `HH:MM` (e.g. `"09:30"`). */
	initialValue?: string;
	/** Placeholder shown in the trigger when no time is selected. */
	placeholder?: string;
	/** Optional CSS for the visible trigger so it matches the host form's input. */
	triggerStyle?: string;
	/** Minute granularity for the right-hand column. Default 1 (every minute). */
	minuteStep?: number;
	/** Called when the user picks a new time. */
	onChange?: (value: string) => void;
}

/**
 * A fully self-managed `HH:MM` time picker that REPLACES the native
 * `<input type="time">`. The native picker can't be reliably auto-closed inside
 * the Electron workbench — `element.blur()` is a no-op there (the workbench
 * focus tracker re-asserts focus), so the native spinner stays open after a
 * selection (the recurring QA "time picker doesn't close" report).
 *
 * This control instead renders a body-mounted popover with two scrollable
 * columns (hours 00-23, minutes 00-59). Picking a minute commits the value and
 * closes the popover deterministically — no dependence on native focus/blur.
 * Picking an hour keeps the popover open (defaulting the minute to `00` so the
 * value is always well-formed) so the user can still choose the minute.
 *
 * Returns a hidden `<input>` whose `.value` is the 24-hour `HH:MM` string, so
 * existing form code that stored the old `<input type="time">` and reads
 * `.value` keeps working unchanged.
 */
export function createTimeDropdown(opts: ICreateTimeDropdownOptions): HTMLInputElement {
	const parent = opts.parent;
	const doc = parent.ownerDocument || document;
	const step = Math.max(1, opts.minuteStep ?? 1);

	const hidden = doc.createElement('input');
	hidden.type = 'hidden';
	hidden.value = opts.initialValue ?? '';
	parent.appendChild(hidden);

	const pad = (n: number) => String(n).padStart(2, '0');
	const parse = (v: string): { hh: string; mm: string } | null => {
		const m = /^(\d{1,2}):(\d{1,2})/.exec(v || '');
		if (!m) { return null; }
		const h = Math.min(23, parseInt(m[1], 10));
		const mi = Math.min(59, parseInt(m[2], 10));
		if (isNaN(h) || isNaN(mi)) { return null; }
		return { hh: pad(h), mm: pad(mi) };
	};
	const to12h = (v: string): string => {
		const p = parse(v);
		if (!p) { return v || opts.placeholder || 'Select time...'; }
		const h = parseInt(p.hh, 10);
		const ampm = h >= 12 ? 'PM' : 'AM';
		const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
		return `${h12}:${p.mm} ${ampm}`;
	};

	const trigger = doc.createElement('button');
	trigger.type = 'button';
	trigger.setAttribute('aria-haspopup', 'dialog');
	trigger.setAttribute('aria-expanded', 'false');
	const fallbackStyle = `width:100%;box-sizing:border-box;padding:6px 10px;background:${COLORS.triggerBackground};color:${COLORS.foreground};border:1px solid ${COLORS.triggerBorder};border-radius:4px;font-size:13px;cursor:pointer;`;
	trigger.style.cssText = `${opts.triggerStyle || fallbackStyle};display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left;font-family:inherit;`;
	const triggerLabel = doc.createElement('span');
	triggerLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
	const triggerIcon = doc.createElement('span');
	// allow-any-unicode-next-line
	triggerIcon.textContent = '\u{1F551}';
	triggerIcon.style.cssText = 'opacity:0.7;font-size:12px;flex-shrink:0;margin-left:6px;';
	trigger.appendChild(triggerLabel);
	trigger.appendChild(triggerIcon);
	const refreshTriggerLabel = () => {
		const v = hidden.value;
		triggerLabel.textContent = to12h(v);
		triggerLabel.style.opacity = v ? '1' : '0.6';
	};
	refreshTriggerLabel();
	hidden.addEventListener('change', refreshTriggerLabel);
	parent.appendChild(trigger);

	const panel = doc.createElement('div');
	panel.className = 'ciyex-custom-dropdown-panel monaco-workbench';
	panel.setAttribute('role', 'dialog');
	panel.style.cssText = `position:fixed;right:auto;bottom:auto;box-sizing:border-box;background-color:${COLORS.background};color:${COLORS.foreground};border:1px solid ${COLORS.border};border-radius:6px;box-shadow:0 6px 18px ${COLORS.shadow};z-index:10000;display:none;padding:0;font-family:var(--vscode-font-family, system-ui, sans-serif);font-size:13px;`;
	(doc.body || doc.documentElement).appendChild(panel);

	// Two scrollable columns.
	const grid = doc.createElement('div');
	grid.style.cssText = 'display:flex;gap:0;height:200px;';
	panel.appendChild(grid);

	const makeColumn = (header: string): { col: HTMLElement; list: HTMLElement } => {
		const wrap = doc.createElement('div');
		wrap.style.cssText = `display:flex;flex-direction:column;min-width:64px;border-right:1px solid ${COLORS.separator};`;
		const head = doc.createElement('div');
		head.textContent = header;
		head.style.cssText = `padding:6px 10px;font-size:11px;font-weight:600;opacity:0.7;text-align:center;border-bottom:1px solid ${COLORS.separator};`;
		const list = doc.createElement('div');
		list.style.cssText = 'flex:1;overflow-y:auto;padding:4px;';
		wrap.appendChild(head);
		wrap.appendChild(list);
		grid.appendChild(wrap);
		return { col: wrap, list };
	};
	const hourCol = makeColumn('Hour');
	const minCol = makeColumn('Min');
	// Drop the trailing border on the last column.
	minCol.col.style.borderRight = 'none';

	let panelOpen = false;
	const state = { hh: '', mm: '' };

	const makeCell = (text: string, selected: boolean, onPick: () => void): HTMLElement => {
		const cell = doc.createElement('div');
		cell.setAttribute('role', 'option');
		cell.textContent = text;
		cell.style.cssText = `padding:5px 12px;cursor:pointer;font-size:13px;line-height:18px;border-radius:4px;text-align:center;font-variant-numeric:tabular-nums;background-color:${selected ? COLORS.hoverBackground : 'transparent'};${selected ? 'font-weight:600;' : ''}`;
		cell.addEventListener('mouseenter', () => { cell.style.backgroundColor = COLORS.hoverBackground; });
		cell.addEventListener('mouseleave', () => { cell.style.backgroundColor = selected ? COLORS.hoverBackground : 'transparent'; });
		cell.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onPick();
		});
		return cell;
	};

	const commit = (close: boolean) => {
		if (!state.hh) { return; }
		if (!state.mm) { state.mm = '00'; }
		const prev = hidden.value;
		hidden.value = `${state.hh}:${state.mm}`;
		refreshTriggerLabel();
		if (close) { closePanel(); }
		if (prev !== hidden.value) {
			hidden.dispatchEvent(new Event('change', { bubbles: true }));
			if (opts.onChange) { opts.onChange(hidden.value); }
		}
	};

	const renderColumns = () => {
		DOM.clearNode(hourCol.list);
		DOM.clearNode(minCol.list);
		let selectedHourCell: HTMLElement | null = null;
		let selectedMinCell: HTMLElement | null = null;
		for (let h = 0; h < 24; h++) {
			const v = pad(h);
			const sel = v === state.hh;
			const cell = makeCell(v, sel, () => {
				state.hh = v;
				// Hour chosen: keep the panel open so the user can pick a minute,
				// but commit a well-formed value (minute defaults to 00) immediately.
				commit(false);
				renderColumns();
			});
			if (sel) { selectedHourCell = cell; }
			hourCol.list.appendChild(cell);
		}
		for (let m = 0; m < 60; m += step) {
			const v = pad(m);
			const sel = v === state.mm;
			const cell = makeCell(v, sel, () => {
				state.mm = v;
				if (!state.hh) { state.hh = '00'; }
				// Minute is the final pick — commit and close deterministically.
				commit(true);
			});
			if (sel) { selectedMinCell = cell; }
			minCol.list.appendChild(cell);
		}
		// Scroll the current selections into view so the user starts near them.
		selectedHourCell?.scrollIntoView({ block: 'center' });
		selectedMinCell?.scrollIntoView({ block: 'center' });
	};

	const positionPanel = () => {
		const rect = trigger.getBoundingClientRect();
		panel.style.left = `${rect.left}px`;
		// Flip above the trigger when there isn't enough room below so the panel
		// is never clipped off the bottom of the viewport.
		const view = doc.defaultView;
		const vh = (view?.innerHeight) || doc.documentElement.clientHeight;
		const spaceBelow = vh - rect.bottom - 8;
		const spaceAbove = rect.top - 8;
		if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
			panel.style.top = `${rect.bottom + 2}px`;
			panel.style.bottom = 'auto';
		} else {
			panel.style.top = 'auto';
			panel.style.bottom = `${vh - rect.top + 2}px`;
		}
		panel.style.minWidth = `${Math.max(rect.width, 140)}px`;
	};
	const openPanel = () => {
		if (!panel.isConnected) { (doc.body || doc.documentElement).appendChild(panel); }
		const parsed = parse(hidden.value);
		state.hh = parsed?.hh ?? '';
		state.mm = parsed?.mm ?? '';
		renderColumns();
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

	const cleanup = () => {
		doc.removeEventListener('mousedown', onDocClick, true);
		win?.removeEventListener('scroll', reposition, true);
		win?.removeEventListener('resize', reposition);
		if (panel.parentElement) { panel.parentElement.removeChild(panel); }
	};
	const observer = new MutationObserver(() => {
		if (!trigger.isConnected) { observer.disconnect(); cleanup(); }
	});
	// Observe the whole document subtree, not just `trigger.parentNode`: when the
	// host form drawer is closed the overlay is removed wholesale, so the trigger
	// leaves the DOM via an ANCESTOR removal that never mutates its own parent's
	// childList. The old parent-only observer therefore never fired and the
	// body-mounted panel leaked (orphaned panels piling up behind every
	// create/edit form). The callback only checks `isConnected`, so the broad
	// scope stays cheap.
	const observeRoot = doc.body || doc.documentElement;
	if (observeRoot) { observer.observe(observeRoot, { childList: true, subtree: true }); }

	// Mirror external value writes (form reset) onto the trigger label.
	const proto = Object.getPrototypeOf(hidden);
	const desc = Object.getOwnPropertyDescriptor(proto, 'value');
	if (desc && desc.set && desc.get) {
		Object.defineProperty(hidden, 'value', {
			configurable: true,
			get() { return desc.get!.call(hidden); },
			set(v: string) { desc.set!.call(hidden, v); refreshTriggerLabel(); },
		});
	}
	Object.defineProperty(hidden, 'ciyexDropdownTrigger', { value: trigger, enumerable: false });

	return hidden;
}

export interface ICreateDateTimeDropdownOptions {
	/** Parent the combined date + time control is appended to. */
	parent: HTMLElement;
	/** Starting value as `yyyy-MM-ddTHH:mm` (extra precision is trimmed). */
	initialValue?: string;
	/** Optional CSS applied to the native date input + the time trigger. */
	inputStyle?: string;
	/** Called when either the date or time part changes. */
	onChange?: (value: string) => void;
}

/**
 * A combined date + time control that replaces `<input type="datetime-local">`.
 * The native datetime-local picker has the same un-closeable problem as the
 * time picker inside the Electron workbench, so the time half uses the custom
 * {@link createTimeDropdown} (closes deterministically on minute pick) paired
 * with a native `<input type="date">` for the calendar half.
 *
 * Returns a hidden `<input>` whose `.value` is the `yyyy-MM-ddTHH:mm` string the
 * old datetime-local control produced, so existing save code is unchanged.
 */
export function createDateTimeDropdown(opts: ICreateDateTimeDropdownOptions): HTMLInputElement {
	const parent = opts.parent;
	const doc = parent.ownerDocument || document;

	const hidden = doc.createElement('input');
	hidden.type = 'hidden';
	parent.appendChild(hidden);

	// Render the date and time controls INSIDE a single bordered field so the
	// time reads as part of the same field rather than a separate picker
	// alongside it (QA: "keep the time inside the same date field"). The wrap
	// carries the input chrome (border / background); the inner date input and
	// time trigger are borderless and transparent.
	const wrap = doc.createElement('div');
	wrap.style.cssText = (opts.inputStyle || '') + 'display:flex;align-items:center;gap:0;padding:0;overflow:hidden;';
	parent.appendChild(wrap);

	const raw = (opts.initialValue || '').slice(0, 16);
	const [initialDate, initialTime] = raw.includes('T') ? raw.split('T') : [raw, ''];

	const innerStyle = 'border:none;background:transparent;color:inherit;font:inherit;outline:none;box-shadow:none;';

	const dateInp = doc.createElement('input') as HTMLInputElement;
	dateInp.type = 'date';
	dateInp.value = initialDate || '';
	dateInp.style.cssText = innerStyle + 'flex:1 1 56%;min-width:0;padding:7px 4px 7px 9px;';
	wrap.appendChild(dateInp);

	const divider = doc.createElement('div');
	divider.style.cssText = 'width:1px;align-self:stretch;margin:5px 0;background:var(--vscode-input-border,var(--vscode-editorWidget-border,#3c3c3c));flex-shrink:0;';
	wrap.appendChild(divider);

	const timeHost = doc.createElement('div');
	timeHost.style.cssText = 'flex:1 1 44%;min-width:0;';
	wrap.appendChild(timeHost);

	const proto = Object.getPrototypeOf(hidden);
	const desc = Object.getOwnPropertyDescriptor(proto, 'value');
	const protoSet = desc?.set;

	let seeded = false;
	const sync = (): void => {
		const d = dateInp.value;
		const t = timeHidden.value;
		const combined = d && t ? `${d}T${t}` : (d || '');
		// Write through the prototype setter to avoid recursing into our override.
		if (protoSet) { protoSet.call(hidden, combined); } else { hidden.value = combined; }
		if (opts.onChange) { opts.onChange(combined); }
		// Fire a DOM 'change' event so consumers that listen on the hidden input
		// (e.g. the appointment form's "End = Start + 15min" auto-calc) react when
		// the user changes the date OR time. The native datetime-local control
		// emitted these; the custom dropdown did not, so the auto-calc never ran.
		// Skip the initial seed (no listeners are attached yet at construction).
		if (seeded) { hidden.dispatchEvent(new Event('change', { bubbles: true })); }
	};

	const timeHidden = createTimeDropdown({
		parent: timeHost,
		initialValue: initialTime,
		placeholder: 'Select time...',
		// Borderless so it sits flush inside the shared bordered field.
		triggerStyle: innerStyle + 'width:100%;padding:7px 9px 7px 4px;',
		onChange: () => sync(),
	});
	dateInp.addEventListener('change', sync);

	if (desc && desc.set && desc.get) {
		Object.defineProperty(hidden, 'value', {
			configurable: true,
			get() { return desc.get!.call(hidden); },
			set(v: string) {
				const trimmed = (v || '').slice(0, 16);
				const [d, t] = trimmed.includes('T') ? trimmed.split('T') : [trimmed, ''];
				dateInp.value = d || '';
				timeHidden.value = t || '';
				desc.set!.call(hidden, v);
			},
		});
	}
	// Seed the combined value from the initial date/time.
	sync();
	seeded = true;

	return hidden;
}
