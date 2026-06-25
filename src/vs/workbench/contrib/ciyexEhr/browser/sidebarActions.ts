/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { createTimeDropdown } from './customDropdown.js';
import { createUsDateField } from './ciyexDateMask.js';
import { FormFieldDef } from './editors/clinicalListEditor.js';

/**
 * Shared sidebar UI primitives used across every Ciyex side-pane:
 * Calendar, Appointments, Patients, Tasks, Encounters, Clinical, Operations,
 * System, etc.
 *
 * Goals (see /sort-out request from 2026-05-21):
 *  - Action icons follow the workbench theme — no per-icon purple / yellow /
 *    red backgrounds. Status badges remain semantically coloured.
 *  - Microsoft Teams-style row actions: tight horizontal group on the right,
 *    consistent hover, accessible tooltip via `title`.
 *  - Lists render an initial batch and reveal the rest behind a single
 *    "Show More" toggle.
 */

/** Initial batch size for side-pane modules — keep small so the rail isn't a wall of rows. */
export const SIDEBAR_INITIAL_PAGE_SIZE = 5;

/** Batch size each subsequent "Show More" click reveals. */
export const SIDEBAR_LOAD_MORE_BATCH = 10;

/** Shared icon button style — neutral, theme-aware. Sized to match the
 *  Microsoft Teams meeting-toolbar icon (slightly bolder than the codicon
 *  default so single-glyph buttons hold their visual weight at small
 *  sizes). */
const ACTION_BTN_BASE = 'display:inline-flex;align-items:center;justify-content:center;padding:4px 6px;border:none;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;background:transparent;color:var(--vscode-foreground);opacity:0.9;transition:background 0.1s,opacity 0.1s;';

/**
 * Detect whether a string is a codicon id (lowercase kebab-case ASCII).
 * Used so callers can pass either `'eye'` (codicon) or `'\u{1F441}'` (emoji).
 */
function isCodiconName(value: string): boolean {
	if (!value) { return false; }
	return /^[a-z][a-z0-9-]*$/.test(value);
}

/** Render a codicon class span or fall back to a monochrome text glyph. */
function setIconContent(host: HTMLElement, symbol: string): void {
	host.textContent = '';
	if (isCodiconName(symbol)) {
		const span = DOM.$('span.codicon.codicon-' + symbol);
		// Codicons render a bit thin at 14px when sitting next to UI-font
		// labels. Bumping to 16px and adding a half-pixel text-stroke gives
		// them the visual weight of a UI-bold glyph without needing a heavy
		// icon font variant.
		(span as HTMLElement).style.cssText = 'font-size:16px;line-height:1;color:inherit;-webkit-text-stroke:0.5px currentColor;';
		host.appendChild(span);
	} else {
		const span = DOM.$('span');
		span.textContent = toMonochromeGlyph(symbol);
		(span as HTMLElement).style.cssText = 'font-size:16px;line-height:1;color:inherit;font-variant-emoji:text;font-weight:600;';
		host.appendChild(span);
	}
}

/**
 * Create a Microsoft Teams-style action icon button. The button itself is
 * always theme-neutral; pass a status badge alongside the row when you need a
 * coloured chip (e.g. Pending / Active / Completed).
 *
 * @param parent Where to append the button.
 * @param symbol The glyph (emoji or unicode) to render inside the button.
 * @param label  The tooltip text. Spoken by screen readers via aria-label.
 * @param onClick The click handler. The button itself stops propagation so the
 *                surrounding row's click handler does not fire.
 */
export function createActionIconButton(parent: HTMLElement, symbol: string, label: string, onClick: () => void): HTMLButtonElement {
	const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
	btn.type = 'button';
	btn.title = label;
	btn.setAttribute('aria-label', label);
	btn.style.cssText = ACTION_BTN_BASE;
	setIconContent(btn, symbol);
	btn.addEventListener('mouseenter', () => {
		btn.style.background = 'var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08))';
		btn.style.opacity = '1';
	});
	btn.addEventListener('mouseleave', () => {
		btn.style.background = 'transparent';
		btn.style.opacity = '0.85';
	});
	btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
	btn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); onClick(); });
	return btn;
}

/**
 * Create the horizontal action-icons container that sits on the right of a
 * record row (Teams-style). Use {@link createActionIconButton} for each
 * button.
 */
export function createRowActionsContainer(parent: HTMLElement): HTMLElement {
	const wrap = DOM.append(parent, DOM.$('.ciyex-row-actions'));
	wrap.style.cssText = 'display:flex;gap:2px;flex-shrink:0;align-items:center;';
	return wrap;
}

export interface IShowMoreState {
	visibleCount: number;
	totalCount: number;
}

/**
 * Render a "Show More" / "Show Less" footer for a side-pane list. The
 * footer is omitted when the total fits in a single batch.
 *
 * @param parent  Where to append the footer.
 * @param state   Current visible vs total counts.
 * @param onMore  Called when the user reveals more — receives the new visible count.
 * @param onLess  Optional callback to collapse back to the initial batch.
 */
export function renderShowMoreFooter(
	parent: HTMLElement,
	state: IShowMoreState,
	onMore: (newVisible: number) => void,
	onLess?: () => void,
): void {
	const { visibleCount, totalCount } = state;
	if (totalCount <= SIDEBAR_INITIAL_PAGE_SIZE) {
		// Nothing to reveal — skip the footer entirely.
		return;
	}

	const footer = DOM.append(parent, DOM.$('.ciyex-show-more'));
	footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;font-size:11px;color:var(--vscode-descriptionForeground);';

	const info = DOM.append(footer, DOM.$('span'));
	info.textContent = `${Math.min(visibleCount, totalCount)} of ${totalCount}`;
	info.style.cssText = 'opacity:0.8;';

	const nav = DOM.append(footer, DOM.$('div'));
	nav.style.cssText = 'display:flex;gap:6px;align-items:center;';

	if (visibleCount < totalCount) {
		const more = DOM.append(nav, DOM.$('button')) as HTMLButtonElement;
		more.type = 'button';
		const remaining = totalCount - visibleCount;
		const batch = Math.min(SIDEBAR_LOAD_MORE_BATCH, remaining);
		more.textContent = remaining > batch ? `Show More (${batch})` : 'Show All';
		more.title = 'Reveal more records';
		more.style.cssText = 'padding:3px 10px;border:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.3));border-radius:3px;background:transparent;color:var(--vscode-foreground);font-size:11px;cursor:pointer;';
		more.addEventListener('mouseenter', () => { more.style.background = 'var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08))'; });
		more.addEventListener('mouseleave', () => { more.style.background = 'transparent'; });
		more.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			onMore(Math.min(visibleCount + SIDEBAR_LOAD_MORE_BATCH, totalCount));
		});
	}

	if (onLess && visibleCount > SIDEBAR_INITIAL_PAGE_SIZE) {
		const less = DOM.append(nav, DOM.$('button')) as HTMLButtonElement;
		less.type = 'button';
		less.textContent = 'Show Less';
		less.title = 'Collapse list';
		less.style.cssText = 'padding:3px 10px;border:1px solid var(--vscode-editorWidget-border,rgba(128,128,128,0.3));border-radius:3px;background:transparent;color:var(--vscode-descriptionForeground);font-size:11px;cursor:pointer;';
		less.addEventListener('mouseenter', () => { less.style.background = 'var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08))'; });
		less.addEventListener('mouseleave', () => { less.style.background = 'transparent'; });
		less.addEventListener('click', (e) => {
			e.stopPropagation();
			e.preventDefault();
			onLess();
		});
	}
}

/**
 * A single row in a Teams-style overflow menu. Use `separator: true` to render
 * a horizontal divider between groups (the other fields are ignored).
 */
export interface IOverflowMenuItem {
	symbol?: string;
	label?: string;
	onClick?: () => void;
	separator?: boolean;
	/** Optional: dim the row and ignore clicks. */
	disabled?: boolean;
}

/**
 * Append the U+FE0E variation selector after each emoji-defaulting codepoint
 * so the glyph renders in *text presentation* (monochrome, follows CSS color)
 * instead of the OS colour-emoji font.
 *
 * Why: most of our icons (eye, pencil, phone, clipboard, trash, heart, …)
 * come from the Miscellaneous
 * Symbols & Pictographs blocks where the Unicode default is "emoji" — so
 * Chromium picks the colour emoji font and ignores CSS `color`. Adding U+FE0E
 * tells the renderer "treat the previous codepoint as text" and the glyph
 * falls back to the regular UI font, which honours `color`.
 *
 * The CSS property `font-variant-emoji: text` covers most cases too, but is
 * Chromium-only and unevenly supported across glyph fonts — so we belt-and-
 * brace by appending the selector as well.
 */
function toMonochromeGlyph(symbol: string): string {
	if (!symbol) { return symbol; }
	let out = '';
	for (const ch of symbol) {
		out += ch;
		const code = ch.codePointAt(0) ?? 0;
		if (isEmojiDefault(code)) {
			out += '\uFE0E';
		}
	}
	return out;
}

function isEmojiDefault(cp: number): boolean {
	// Ranges covering the codepoints we actually use in the sidebars +
	// other common UI emoji. Anything in these ranges defaults to emoji
	// presentation, so we tag it with VS-15. Pure-symbol codepoints
	// (e.g. U+2713 check mark, U+2716 cross mark) are not in these ranges
	// and are left alone.
	return (
		(cp >= 0x1F300 && cp <= 0x1FAFF) ||  // Miscellaneous Symbols & Pictographs, Emoticons, Transport, Supplemental, etc.
		(cp >= 0x2600 && cp <= 0x27BF && (
			cp === 0x2614 || cp === 0x2615 ||
			cp === 0x2648 || cp === 0x2653 ||
			cp === 0x267F || cp === 0x2693 ||
			cp === 0x26A1 || cp === 0x26AA || cp === 0x26AB ||
			cp === 0x26BD || cp === 0x26BE ||
			cp === 0x26C4 || cp === 0x26C5 ||
			cp === 0x26CE || cp === 0x26D4 ||
			cp === 0x26EA || cp === 0x26F2 || cp === 0x26F3 || cp === 0x26F5 || cp === 0x26FA || cp === 0x26FD ||
			cp === 0x2705 || cp === 0x2728 ||
			cp === 0x274C || cp === 0x274E ||
			(cp >= 0x2753 && cp <= 0x2755) ||
			cp === 0x2757 ||
			(cp >= 0x2795 && cp <= 0x2797) ||
			cp === 0x27B0 || cp === 0x27BF
		))
	);
}

/**
 * Workbench theme kind, derived from the `vs` / `vs-dark` / `hc-black` /
 * `hc-light` class VS Code applies to <body> and the monaco workbench root.
 * Reading this directly is more reliable than depending on CSS variables —
 * several themes leave `--vscode-menu-background` set to a dark chrome-menu
 * colour even on light workbench themes.
 */
type ThemeKind = 'light' | 'dark' | 'hcLight' | 'hcDark';

interface IThemePalette {
	background: string;
	foreground: string;
	border: string;
	shadow: string;
	separator: string;
	hoverBackground: string;
	hoverForeground: string;
}

const THEME_PALETTES: Record<ThemeKind, IThemePalette> = {
	light: {
		background: '#ffffff',
		foreground: '#1f1f1f',
		border: '#c8c8c8',
		shadow: 'rgba(0,0,0,0.18)',
		separator: 'rgba(0,0,0,0.12)',
		hoverBackground: '#e8e8e8',
		hoverForeground: '#000000',
	},
	dark: {
		background: '#252526',
		foreground: '#e6e6e6',
		border: 'rgba(255,255,255,0.18)',
		shadow: 'rgba(0,0,0,0.45)',
		separator: 'rgba(255,255,255,0.14)',
		hoverBackground: '#37373d',
		hoverForeground: '#ffffff',
	},
	hcLight: {
		background: '#ffffff',
		foreground: '#000000',
		border: '#000000',
		shadow: 'rgba(0,0,0,0.45)',
		separator: '#000000',
		hoverBackground: '#0f4a85',
		hoverForeground: '#ffffff',
	},
	hcDark: {
		background: '#000000',
		foreground: '#ffffff',
		border: '#6fc3df',
		shadow: 'rgba(0,0,0,0.6)',
		separator: '#6fc3df',
		hoverBackground: '#0f4a85',
		hoverForeground: '#ffffff',
	},
};

function detectThemeKind(doc: Document, anchor?: HTMLElement): ThemeKind {
	// Walk ancestors from the anchor up to <html>, checking each element's
	// classList for the workbench theme class. The class is applied to
	// either the monaco-workbench element or <body>/<html>, so a parent
	// walk catches it without using selector-based lookups (the hygiene
	// linter disallows querySelector / getElementsByClassName because
	// markup-bound selectors are fragile).
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
	for (const root of [doc.body, doc.documentElement]) {
		if (root) {
			const kind = classify(root.classList);
			if (kind) { return kind; }
		}
	}
	// Default to dark — matches VS Code's default theme.
	return 'dark';
}

/** Track the currently open menu so opening a new one auto-closes the previous. */
let activeOverflowMenu: HTMLElement | undefined;

function closeActiveOverflowMenu(): void {
	if (activeOverflowMenu && activeOverflowMenu.parentElement) {
		activeOverflowMenu.parentElement.removeChild(activeOverflowMenu);
	}
	activeOverflowMenu = undefined;
}

/**
 * Render a Teams-style popup menu anchored to `anchor`. Each item renders as
 * a row with a large icon + readable label, matching the chat overflow menu
 * the user referenced.
 *
 * The menu auto-closes on outside click, scroll, or Escape. Only one menu is
 * open at a time across the workbench.
 */
function openOverflowMenu(anchor: HTMLElement, items: IOverflowMenuItem[]): void {
	closeActiveOverflowMenu();

	const ownerDoc = anchor.ownerDocument || document;
	const menu = ownerDoc.createElement('div');
	menu.className = 'ciyex-overflow-menu';

	// Resolve concrete colors by inspecting the workbench theme. VS Code adds
	// one of `vs`, `vs-dark`, `hc-black`, or `hc-light` to <body> (and the
	// monaco workbench root) — we use that as the source of truth instead of
	// CSS variables, which several user themes set incorrectly for `menu.*`.
	const theme = detectThemeKind(ownerDoc, anchor);
	const palette = THEME_PALETTES[theme];

	menu.style.cssText = [
		'position:fixed',
		'z-index:1000',
		'min-width:220px',
		'max-width:300px',
		'padding:4px 0',
		'border-radius:6px',
		`background:${palette.background}`,
		`color:${palette.foreground}`,
		`border:1px solid ${palette.border}`,
		`box-shadow:0 6px 16px ${palette.shadow}`,
		'font-size:13px',
		'overflow:auto',
		'max-height:60vh',
	].join(';');

	for (const item of items) {
		if (item.separator) {
			const sep = ownerDoc.createElement('div');
			sep.style.cssText = `height:1px;margin:4px 8px;background:${palette.separator};`;
			menu.appendChild(sep);
			continue;
		}
		const row = ownerDoc.createElement('button');
		row.type = 'button';
		row.setAttribute('aria-label', item.label || '');
		row.disabled = !!item.disabled;
		row.style.cssText = [
			'display:flex',
			'align-items:center',
			'gap:12px',
			'width:100%',
			'padding:8px 14px',
			'border:none',
			'background:transparent',
			'color:inherit',
			// Anchor to the workbench UI font so codicons + labels share a
			// consistent baseline + family across every theme.
			'font-family:var(--vscode-font-family, "Segoe UI", "Helvetica Neue", sans-serif)',
			'font-size:13px',
			'font-weight:500',
			'text-align:left',
			'cursor:' + (item.disabled ? 'default' : 'pointer'),
			'opacity:' + (item.disabled ? '0.45' : '1'),
		].join(';');

		// Icon and label both anchor to the workbench UI font + the same
		// weight so they read as one consistent typographic block. Icons are
		// 16px with a half-pixel text-stroke (Teams-toolbar weight); labels
		// are 13px medium so they don't drown out the bolder icons.
		const iconEl = ownerDoc.createElement('span');
		iconEl.style.cssText = 'flex-shrink:0;width:20px;text-align:center;display:inline-flex;align-items:center;justify-content:center;color:inherit;';
		setIconContent(iconEl, item.symbol || '');
		row.appendChild(iconEl);

		const labelEl = ownerDoc.createElement('span');
		labelEl.textContent = item.label || '';
		labelEl.style.cssText = 'flex:1;font-family:var(--vscode-font-family, inherit);font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3;letter-spacing:0.1px;';
		row.appendChild(labelEl);

		if (!item.disabled) {
			row.addEventListener('mouseenter', () => {
				row.style.background = palette.hoverBackground;
				row.style.color = palette.hoverForeground;
			});
			row.addEventListener('mouseleave', () => {
				row.style.background = 'transparent';
				row.style.color = 'inherit';
			});
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				closeActiveOverflowMenu();
				try { if (item.onClick) { item.onClick(); } } catch { /* swallow — UI should never crash on a menu click */ }
			});
		}

		menu.appendChild(row);
	}

	// Position: anchor the menu's LEFT edge just to the right of the
	// overflow button so the popup flies open into the editor area instead
	// of covering the row. Flip back to the left side only when there is no
	// horizontal room (e.g. sidebar docked far right).
	const rect = anchor.getBoundingClientRect();
	// Resolve the target window the anchor lives in so multi-window scenarios
	// (e.g. floating editor windows) measure the right viewport. Fall back to
	// `mainWindow` if the anchor is detached.
	const win = (DOM.getWindow(anchor) || mainWindow);
	const viewportH = win.innerHeight;
	const viewportW = win.innerWidth;
	menu.style.visibility = 'hidden';
	(ownerDoc.body || ownerDoc.documentElement).appendChild(menu);
	const menuH = menu.offsetHeight;
	const menuW = menu.offsetWidth;

	let top = rect.top;
	if (top + menuH > viewportH - 8) {
		top = Math.max(8, viewportH - menuH - 8);
	}

	let left = rect.right + 6;
	if (left + menuW > viewportW - 8) {
		// Not enough room on the right - place it flush to the left of the
		// trigger instead. As a last resort, clamp inside the viewport.
		left = Math.max(8, rect.left - menuW - 6);
		if (left + menuW > viewportW - 8) { left = Math.max(8, viewportW - menuW - 8); }
	}
	menu.style.top = `${Math.round(top)}px`;
	menu.style.left = `${Math.round(left)}px`;
	menu.style.visibility = 'visible';

	activeOverflowMenu = menu;

	// Dismiss on outside click / Escape / scroll / blur.
	const onPointerDown = (e: MouseEvent) => {
		if (!menu.contains(e.target as Node)) { closeActiveOverflowMenu(); cleanup(); }
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') { closeActiveOverflowMenu(); cleanup(); }
	};
	const onScroll = () => { closeActiveOverflowMenu(); cleanup(); };
	const cleanup = () => {
		ownerDoc.removeEventListener('mousedown', onPointerDown, true);
		ownerDoc.removeEventListener('keydown', onKey, true);
		win.removeEventListener('scroll', onScroll, true);
		win.removeEventListener('blur', onScroll);
	};
	// Defer registration so the click that opened the menu doesn't immediately close it.
	win.setTimeout(() => {
		ownerDoc.addEventListener('mousedown', onPointerDown, true);
		ownerDoc.addEventListener('keydown', onKey, true);
		win.addEventListener('scroll', onScroll, true);
		win.addEventListener('blur', onScroll);
	}, 0);
}

/**
 * Create the Teams-style overflow trigger - a single triple-dot icon button
 * that opens a popup listing each action with a large icon + label when
 * clicked. Items can be passed eagerly or as a thunk so per-row state
 * (e.g. current status) is captured at click time.
 */
export function createOverflowMenuButton(
	parent: HTMLElement,
	items: IOverflowMenuItem[] | (() => IOverflowMenuItem[]),
	label = 'More actions',
): HTMLButtonElement {
	// Use the workbench `ellipsis` codicon so the trigger glyph has the same
	// thin stroke as the icons inside the popup (matches the Teams meeting
	// toolbar "More" button).
	const btn = createActionIconButton(parent, 'ellipsis', label, () => {
		const resolved = typeof items === 'function' ? items() : items;
		const usable = resolved.filter(i => i.separator || (i.label && i.onClick));
		if (usable.length === 0) { return; }
		openOverflowMenu(btn, resolved);
	});
	return btn;
}

// ---------------------------------------------------------------------------
//  Inline record-edit dialog
// ---------------------------------------------------------------------------

/**
 * Field schema for {@link openRecordEditDialog}. Mirrors the small subset of
 * HTML input types the panes need (text / number / email / phone / date /
 * textarea / select). Add new kinds here as panes need them.
 */
export interface IEditFieldDef {
	key: string;
	label: string;
	kind?: 'text' | 'number' | 'email' | 'tel' | 'date' | 'time' | 'textarea' | 'select' | 'search';
	options?: Array<{ value: string; label: string }>;
	/** For 'select' fields whose options come from an API rather than a static
	 *  list. Resolved into {@link options} by {@link loadFieldOptions} before the
	 *  dialog opens — e.g. Inventory Category / Location / Supplier dropdowns that
	 *  load from `/api/inventory/categories`, `/api/inventory/locations`,
	 *  `/api/suppliers/list`. */
	optionsApiPath?: string;
	/** Item field used as the option label when loading from {@link optionsApiPath}. Default 'name'. */
	optionLabelKey?: string;
	/** Item field used as the option value when loading from {@link optionsApiPath}. Default 'id'. */
	optionValueKey?: string;
	/** For numeric/tel inputs: enforce a maximum number of digits. Extra digits
	 *  are stripped as the user types and a count above this is rejected on save. */
	maxDigits?: number;
	/** For numeric/tel inputs: enforce a minimum number of digits on save. */
	minDigits?: number;
	required?: boolean;
	placeholder?: string;
	hint?: string;
	/** Render the input as read-only (non-editable) — used for derived /
	 *  auto-calculated fields such as BMI. Pairs naturally with {@link compute}. */
	readonly?: boolean;
	/** Derived-value callback. When present the field's value is (re)computed
	 *  from the other field values whenever ANY input in the form changes (and
	 *  once on open). Returns the new string value. Use for fields like BMI that
	 *  the chart editor auto-calculates from height & weight. */
	compute?: (values: Record<string, string>) => string;
	/** Width hint as a percentage of the row (defaults to 100 for full row). */
	widthPct?: number;
	/** Conditional visibility: only show this field when another field's current
	 *  value matches (`equals`) or differs from (`notEquals`) the given value.
	 *  Mirrors the chart editor's `showWhen` (e.g. hide the subscriber fields on
	 *  an insurance form when "Relationship to Patient" is "Self"). */
	showWhen?: { field: string; equals?: string; notEquals?: string };
	/** Search-typeahead callback used when {@link kind} is `'search'`. Called
	 *  while the user types — returns a list of matches to show in a dropdown
	 *  beneath the input. */
	onSearch?: (query: string) => Promise<Array<{ value: string; label: string; description?: string; details?: Record<string, string> }>>;
	/** Optional callback fired when the user selects a search match. Lets the
	 *  caller fill related fields (e.g. selecting a patient autofills
	 *  patientId). */
	onSelectSearchResult?: (item: { value: string; label: string; details?: Record<string, string> }, allInputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
	/** Search ('search' kind) fields lock to a value chosen from the results
	 *  dropdown by default: free-typed text that isn't picked (e.g. a provider not
	 *  in the directory) is wiped on blur and rejected on save. Set this to
	 *  `false` for the rare typeahead that should also accept arbitrary text. */
	strictSelect?: boolean;
	/** Render the field's row hidden (display:none). Used for fields that only
	 *  carry an auto-filled value from a related `search` field (e.g. patientId)
	 *  so they are submitted but not shown — mirrors the editor's `hidden`. */
	hidden?: boolean;
	/** Initial value for a freshly-opened create form. Lets the sidebar drawer
	 *  pre-select the same defaults as the editor's "New" form (e.g. status =
	 *  Active, priority = Routine, refills = 0). */
	defaultValue?: string | number;
}

/**
 * Adapt an editor's {@link FormFieldDef} list (the canonical "New X" form schema
 * in the editors) into the sidebar drawer's {@link IEditFieldDef} shape, so the
 * `+` quick-create drawer always shows the SAME fields as the full editor's
 * create form — one source of truth, no drift. Shared by the clinical /
 * operations / system menu panes.
 *
 * `search` fields map to plain text here; {@link withTypeaheadSearch} (applied
 * when the drawer opens) upgrades the well-known keys (patient, provider, code
 * systems, insurance, …) back into real typeaheads by key. Validation patterns
 * are intentionally dropped — the drawer doesn't enforce them — but every field,
 * label, option, default and hidden flag carries over.
 */
export function formFieldsToEditFields(formFields: FormFieldDef[]): IEditFieldDef[] {
	return formFields.map((f): IEditFieldDef => {
		const def = typeof f.defaultValue === 'function' ? f.defaultValue() : f.defaultValue;
		return {
			key: f.key,
			label: f.label,
			// 'search' degrades to text; withTypeaheadSearch re-upgrades known keys.
			kind: f.type === 'search' ? 'text' : f.type,
			required: f.required,
			placeholder: f.placeholder,
			options: f.options?.map(o => ({ value: o.value, label: o.label })),
			optionsApiPath: f.optionsApiPath,
			optionLabelKey: f.optionsLabelField,
			optionValueKey: f.optionsValueField,
			maxDigits: f.maxDigits,
			hidden: f.hidden,
			defaultValue: def,
			// Mirror the editor form's per-field layout exactly: the editor renders
			// every field in one column of a two-column grid unless the field opts
			// into `width: 'span 2'` (full row). So a textarea WITHOUT an explicit
			// span (e.g. Patient Recall "Notes") stays half-width here too, instead
			// of forcing every textarea to span the full row — that was the only
			// thing making the `+` quick-create drawer diverge from the editor's
			// "New Patient Recall" form.
			widthPct: /\bspan\s*2\b/.test(f.width ?? '') ? 100 : 50,
		};
	});
}

export interface IEditDialogOptions {
	title: string;
	fields: IEditFieldDef[];
	values: Record<string, unknown>;
	onSave: (next: Record<string, unknown>) => Promise<void> | void;
	primaryLabel?: string;
	themeAnchor?: HTMLElement;
	/**
	 * Optional composite sections rendered below the plain fields, mirroring the
	 * full editor's `formExtras` hook (e.g. Care Plans Goals / Interventions).
	 * The returned `collect()` is merged into the save payload, so the `+`
	 * quick-create drawer produces the SAME record shape as the editor form.
	 */
	formExtras?: (container: HTMLElement, values: Record<string, unknown>) => { collect: () => Record<string, unknown> };
	/** Surface style:
	 *  - `'drawer'` (default): right-side slide-out, full viewport height.
	 *    Matches the EHR-UI Patient Recall edit flow.
	 *  - `'modal'`: centred popup overlay (matches the snapshot page's
	 *    `+` menu and dashboard card CRUD).
	 */
	variant?: 'drawer' | 'modal';
}

/**
 * Walk a field schema and inject `kind: 'search'` + an `onSearch` /
 * `onSelectSearchResult` callback for well-known typeahead fields (patient,
 * provider/prescriber, common code systems). Lets every sidebar drawer get
 * a real typeahead instead of a plain text input — which is also the only
 * reliable way to keep Chromium's native autofill suggestion popup from
 * showing on those fields, no matter what `autocomplete` token we set.
 *
 * Shared by clinical / operations / system menu panes so all three drawers
 * get the same patient + provider lookups without duplicating the fetch
 * wiring.
 */
/**
 * Common CVX immunization codes used as a client-side fallback when the
 * ciyex-codes service has no CVX dataset loaded for the org (API returns
 * empty). Kept in sync with IMMUNIZATIONS_FORM_FIELDS.cvxCode.fallbackOptions
 * in clinicalEditors.ts so the `+` quick-create drawer surfaces the same
 * suggestions as the full immunizations editor.
 */
const FALLBACK_CVX_CODES: Array<{ code: string; shortDescription: string }> = [
	{ code: '03', shortDescription: 'MMR (Measles, Mumps, Rubella)' },
	{ code: '08', shortDescription: 'Hepatitis B, adolescent or pediatric' },
	{ code: '10', shortDescription: 'IPV (Poliovirus, inactivated)' },
	{ code: '17', shortDescription: 'HIB (Haemophilus influenzae type b)' },
	{ code: '20', shortDescription: 'DTaP' },
	{ code: '21', shortDescription: 'Varicella (Chickenpox)' },
	{ code: '33', shortDescription: 'Pneumococcal polysaccharide (PPV23)' },
	{ code: '43', shortDescription: 'Hepatitis B, adult' },
	{ code: '45', shortDescription: 'Hepatitis B, pediatric' },
	{ code: '48', shortDescription: 'Hib (PRP-T)' },
	{ code: '49', shortDescription: 'Hib (PRP-OMP)' },
	{ code: '52', shortDescription: 'Hepatitis A, adult' },
	{ code: '62', shortDescription: 'HPV, bivalent' },
	{ code: '83', shortDescription: 'Hepatitis A, pediatric/adolescent' },
	{ code: '85', shortDescription: 'Hepatitis A-Hepatitis B' },
	{ code: '88', shortDescription: 'Flu, unspecified' },
	{ code: '94', shortDescription: 'MMR-Varicella (MMRV)' },
	{ code: '100', shortDescription: 'Pneumococcal conjugate (PCV7)' },
	{ code: '103', shortDescription: 'Meningococcal' },
	{ code: '110', shortDescription: 'DTaP-Hepatitis B-IPV' },
	{ code: '113', shortDescription: 'Td, adult' },
	{ code: '114', shortDescription: 'Meningococcal MCV4P' },
	{ code: '115', shortDescription: 'Tdap' },
	{ code: '116', shortDescription: 'Rotavirus, pentavalent' },
	{ code: '121', shortDescription: 'Zoster (shingles), live' },
	{ code: '133', shortDescription: 'PCV13 (Pneumococcal conjugate)' },
	{ code: '135', shortDescription: 'Influenza, high dose' },
	{ code: '140', shortDescription: 'Influenza, seasonal, injectable' },
	{ code: '150', shortDescription: 'Influenza, injectable, quadrivalent' },
	{ code: '158', shortDescription: 'Influenza, injectable, quadrivalent, preservative free' },
	{ code: '162', shortDescription: 'Meningococcal B, recombinant' },
	{ code: '165', shortDescription: 'HPV9 (Human Papillomavirus 9-valent)' },
	{ code: '166', shortDescription: 'PCV15' },
	{ code: '167', shortDescription: 'PCV20' },
	{ code: '174', shortDescription: 'COVID-19 (Moderna)' },
	{ code: '176', shortDescription: 'COVID-19 Pfizer-BioNTech' },
	{ code: '207', shortDescription: 'COVID-19 Moderna' },
	{ code: '210', shortDescription: 'COVID-19 Janssen (Johnson & Johnson)' },
	{ code: '212', shortDescription: 'COVID-19 Novavax' },
	{ code: '228', shortDescription: 'Zoster (shingles), recombinant (Shingrix)' },
];

export function withTypeaheadSearch(
	fields: IEditFieldDef[],
	api: { fetch(path: string, init?: RequestInit): Promise<Response> }
): IEditFieldDef[] {
	const fetchPatients = async (q: string) => {
		try {
			const res = await api.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
			if (!res.ok) { return []; }
			const data = await res.json();
			const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
			return list.map(p => {
				const name = `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || String(p.name || p.id);
				const pid = String(p.id ?? p.patientId ?? '');
				const contact = (p.contact ?? p.contactInfo) as Record<string, unknown> | undefined;
				const email = String(p.email || p.emailAddress || contact?.email || '');
				const phone = String(p.phoneNumber || p.phone || p.mobile || p.cellPhone || p.homePhone || contact?.phoneNumber || contact?.phone || contact?.mobile || '');
				return { value: name, label: name, description: pid ? `MRN ${pid}` : undefined, details: { patientId: pid, firstName: (p.firstName as string) || '', lastName: (p.lastName as string) || '', email, phone } };
			});
		} catch { return []; }
	};
	const fetchProviders = async (q: string) => {
		try {
			const urls = [`/api/providers?search=${encodeURIComponent(q)}&page=0&size=10`, `/api/fhir-resource/providers?search=${encodeURIComponent(q)}&page=0&size=10`];
			for (const url of urls) {
				const res = await api.fetch(url);
				if (!res.ok) { continue; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
				if (list.length === 0) { continue; }
				return list.map(p => {
					const id = p.identification as Record<string, unknown> | undefined;
					const firstName = ((id?.firstName ?? p.firstName ?? '') as string);
					const lastName = ((id?.lastName ?? p.lastName ?? '') as string);
					const name = (p.name || p.fullName || `${firstName} ${lastName}`.trim() || '') as string;
					const npi = (p.npi as string) || '';
					return { value: name, label: name, description: npi ? `NPI ${npi}` : undefined, details: { npi, firstName, lastName } };
				});
			}
			return [];
		} catch { return []; }
	};
	// Facility / location search — claims "Facility" picker. Locations live on
	// `/api/locations` (full list, no server filter), so we match client-side.
	const fetchFacilities = async (q: string) => {
		try {
			const res = await api.fetch(`/api/locations`);
			if (!res.ok) { return []; }
			const data = await res.json();
			const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
			const lq = q.toLowerCase();
			return list
				.filter(l => !lq || String(l.name || l.locationName || l.label || '').toLowerCase().includes(lq))
				.slice(0, 10)
				.map(l => {
					const name = String(l.name || l.locationName || l.label || '');
					const id = String(l.id ?? l.locationId ?? '');
					return { value: name, label: name, description: id || undefined, details: { id, name } };
				});
		} catch { return []; }
	};
	// Medical-code searches resolve through the ciyex-codes service via the app
	// proxy: GET /api/app-proxy/ciyex-codes/api/codes/{SYSTEM}/search?q=… which
	// returns a Spring Page<MedicalCode> ({ content: [...] }). `{SYSTEM}` is a
	// CodeSystem enum value (ICD10_CM, CPT, HCPCS, CDT, NDC, LOINC, SNOMED_CT,
	// CVX, …). The previous code endpoints (`/api/codes/cpt`, `/api/codes/rxnorm`,
	// … with a `search=` param) collided with the patient-scoped
	// `/api/codes/{patientId}` route on the main API — Spring tried to bind the
	// system name as a numeric patientId and 4xx'd, so code typeahead in every
	// sidebar drawer silently returned no results (QA: "codes search not working").
	// The label is set to the code itself (the field stores a code) with the
	// description surfaced as the dropdown's secondary line so codes are
	// distinguishable while choosing.
	const CIYEX_CODES_BASE = '/api/app-proxy/ciyex-codes/api/codes';
	const fetchCodeSystem = async (system: string, q: string) => {
		try {
			const res = await api.fetch(`${CIYEX_CODES_BASE}/${system}/search?q=${encodeURIComponent(q)}&page=0&size=10`);
			if (!res.ok) { return []; }
			const data = await res.json();
			const list = (data?.content || data?.data?.content || data?.data || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
			return list.map(c => {
				const code = String(c.code || c.id || '');
				const desc = String(c.shortDescription || c.description || c.longDescription || c.display || c.name || '');
				return { value: code, label: code, description: desc, details: { code, description: desc } };
			});
		} catch { return []; }
	};
	// Custom / org-defined codes live on the main API's global_codes search
	// route, which is ApiResponse-wrapped ({ data: [...] }) and keyed on `q`.
	const fetchGlobalCodes = async (q: string) => {
		try {
			const res = await api.fetch(`/api/global_codes/search?q=${encodeURIComponent(q)}&page=0&size=10`);
			if (!res.ok) { return []; }
			const data = await res.json();
			const list = (data?.data?.content || data?.content || data?.data || (Array.isArray(data) ? data : [])) as Array<Record<string, unknown>>;
			return list.map(c => {
				const code = String(c.code || c.id || '');
				const desc = String(c.shortDescription || c.description || c.display || c.name || '');
				return { value: code, label: code, description: desc, details: { code, description: desc } };
			});
		} catch { return []; }
	};

	// Back-fill a COMPANION field from a selection and mark it as a confirmed
	// pick. Several companion fields (Lab Order's testCode, claims' payerId /
	// insurerId, facilityId) are themselves rendered as strict-select search
	// inputs — without stamping `dataset.selected`, the submit-time strict guard
	// wipes the auto-filled value and the form can't be saved (the Lab Order
	// "Test Code disappears on Create" bug).
	const fillRelated = (
		all: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
		key: string, val: string, onlyIfEmpty = false
	): void => {
		const i = all.get(key);
		if (!i || (onlyIfEmpty && i.value)) { return; }
		i.value = val;
		i.dataset.selected = '1';
	};

	return fields.map(f => {
		const k = f.key.toLowerCase();
		if (k === 'patientname' || k === 'patientfirstname') {
			return {
				...f,
				kind: 'search' as const,
				onSearch: fetchPatients,
				onSelectSearchResult: (item, all) => {
					const set = (key: string, val: string) => { const i = all.get(key); if (i) { i.value = val; } };
					set('patientId', item.details?.patientId || '');
					set('patientFirstName', item.details?.firstName || '');
					set('patientLastName', item.details?.lastName || '');
					// Auto-fill Phone + Email companions (Patient Recall form keys
					// patientPhone / patientEmail) from the selected patient record.
					if (item.details?.phone) { set('patientPhone', item.details.phone); }
					if (item.details?.email) { set('patientEmail', item.details.email); }
					// Auto-fill the Receipt Email (Payments form) from the patient record.
					if (item.details?.email) { set('receiptEmail', item.details.email); }
				},
			};
		}
		if (['prescribername', 'prescribingdoctor', 'providername', 'referringprovider', 'physicianname', 'administeredby', 'author', 'authorname', 'provider', 'orderingprovider', 'providerid', 'billingprovider', 'billingproviderid'].includes(k)) {
			return {
				...f,
				kind: 'search' as const,
				onSearch: fetchProviders,
				onSelectSearchResult: (item, all) => {
					const npi = item.details?.npi || '';
					if (npi) {
						for (const key of ['prescriberNpi', 'providerNpi', 'npi', 'specialistNpi']) {
							const i = all.get(key);
							if (i && !i.value) { i.value = npi; }
						}
					}
				},
			};
		}
		// CVX vaccine code search. When ciyex-codes has no CVX dataset loaded for
		// this org the API returns empty, so fall back to a client-side filter of
		// the common CVX codes — mirrors the right-panel editor's `fallbackOptions`
		// (IMMUNIZATIONS_FORM_FIELDS.cvxCode) so the `+` drawer shows the same
		// suggestions instead of an empty dropdown.
		if (k === 'cvxcode') {
			return {
				...f, kind: 'search' as const, onSearch: async (q) => {
					const apiResults = await fetchCodeSystem('CVX', q);
					if (apiResults.length > 0) { return apiResults; }
					const lq = q.toLowerCase();
					return FALLBACK_CVX_CODES
						.filter(c => c.code.includes(q) || c.shortDescription.toLowerCase().includes(lq))
						.slice(0, 10)
						.map(c => ({ value: c.code, label: c.code, description: c.shortDescription, details: { code: c.code, description: c.shortDescription } }));
				},
			};
		}
		// CPT procedure code search. Selecting a code auto-fills the companion
		// "Procedure Description" box (Authorization drawer) from the result.
		if (k === 'procedurecode' || k === 'cptcode') {
			return {
				...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('CPT', q),
				onSelectSearchResult: (item, all) => {
					const desc = item.details?.description || '';
					if (desc) { for (const key of ['procedureDescription', 'cptDescription']) { fillRelated(all, key, desc); } }
				},
			};
		}
		// ICD-10 diagnosis code search (incl. the claim form's primary/secondary/
		// tertiary/quaternary diagnosis pickers — QA issue 10). Selecting a code
		// auto-fills the companion "Diagnosis Description" box.
		if (k === 'diagnosiscode' || k === 'icd10' || k === 'icdcode'
			|| k === 'primarydiagnosis' || k === 'secondarydiagnosis' || k === 'tertiarydiagnosis' || k === 'quaternarydiagnosis'
			|| /diagnosis$/.test(k)) {
			return {
				...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('ICD10_CM', q),
				onSelectSearchResult: (item, all) => {
					const desc = item.details?.description || '';
					if (desc) { for (const key of ['diagnosisDescription', 'icdDescription']) { fillRelated(all, key, desc); } }
				},
			};
		}
		// Facility / location search (claims "Facility"). When the field already
		// carries a select options source (optionsApiPath / preloaded options) —
		// e.g. the Inventory "Location" dropdown, which loads its locations from
		// the API exactly like its Category/Supplier siblings — leave it as a
		// select dropdown instead of degrading it to a blank typeahead box.
		if (k === 'facilityid' || k === 'facility' || k === 'locationid' || k === 'location') {
			if (f.optionsApiPath || (f.options && f.options.length > 0)) {
				return f;
			}
			return {
				...f,
				kind: 'search' as const,
				onSearch: fetchFacilities,
				onSelectSearchResult: (item, all) => {
					const id = item.details?.id || '';
					if (id) { for (const key of ['facilityId', 'locationId']) { fillRelated(all, key, id); } }
				},
			};
		}
		// LOINC lab test NAME search (the Lab Order form's "Test Name" picker,
		// keyed `testDisplay`). The field stores the human-readable test name, so
		// the dropdown surfaces the description as the primary label (code as the
		// secondary line) and selecting one back-fills the companion `testCode`
		// input — mirroring the full Lab editor's search/relatedField wiring.
		if (k === 'testdisplay' || k === 'testname') {
			return {
				...f,
				kind: 'search' as const,
				onSearch: async (q) => (await fetchCodeSystem('LOINC', q)).map(r => ({
					value: r.details?.description || r.description || r.value,
					label: r.details?.description || r.description || r.value,
					description: r.value,
					details: r.details,
				})),
				onSelectSearchResult: (item, all) => {
					const code = item.details?.code || '';
					if (code) { fillRelated(all, 'testCode', code); }
				},
			};
		}
		// LOINC lab test code search.
		if (k === 'testcode' || k === 'loinc') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('LOINC', q) };
		}
		// NDC medication code search (ciyex-codes has no RxNorm system; meds are NDC).
		if (k === 'medicationcode' || k === 'rxnormcode' || k === 'ndccode') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('NDC', q) };
		}
		// HCPCS code search.
		if (k === 'hcpcscode') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('HCPCS', q) };
		}
		// CDT (dental) code search.
		if (k === 'cdtcode') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('CDT', q) };
		}
		// SNOMED clinical term search.
		if (k === 'snomedcode') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('SNOMED_CT', q) };
		}
		// Generic / custom org-defined codes (Medical Codes module).
		if (k === 'code') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchGlobalCodes(q) };
		}
		// Insurance / payer search (incl. the claim form's "Payer / Insurer"
		// picker keyed `payerId` — QA issue 10).
		if (k === 'insurancename' || k === 'payername' || k === 'payerid' || k === 'payer' || k === 'insurerid' || k === 'insurer' || k === 'payorid') {
			return {
				...f,
				kind: 'search' as const,
				onSearch: async (q) => {
					try {
						// Payers live on `/api/insurance-companies` (the `/api/insurances`
						// path the sidebar used before does not exist → 404 → no results).
						// The route returns the full list ({ data: [...] }) with no server
						// filter, so we match the query client-side.
						const res = await api.fetch(`/api/insurance-companies`);
						if (!res.ok) { return []; }
						const data = await res.json();
						const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
						const lq = q.toLowerCase();
						return list
							.filter(p => !lq || String(p.name || p.label || '').toLowerCase().includes(lq))
							.slice(0, 10)
							.map(p => ({ value: String(p.name || p.label || ''), label: String(p.name || p.label || ''), description: String(p.payerId || p.id || ''), details: { id: String(p.id ?? p.payerId ?? '') } }));
					} catch { return []; }
				},
				onSelectSearchResult: (item, all) => {
					const id = item.details?.id || '';
					if (id) { for (const key of ['payerId', 'insurerId']) { fillRelated(all, key, id); } }
				},
			};
		}
		return f;
	});
}

/**
 * Resolve every `kind: 'select'` field that carries an {@link IEditFieldDef.optionsApiPath}
 * into a concrete `options` list by fetching the endpoint, so the sidebar
 * create/edit dialog renders a real themed dropdown (not a bare number/text
 * input). Used by the Operations Inventory `+` quick-create so its Category /
 * Location / Supplier fields match the full Inventory editor's dropdowns.
 *
 * Returns a fresh clone of `fields` (the input array is never mutated, so the
 * shared static schema doesn't accumulate options across opens). Fields without
 * an `optionsApiPath` pass through unchanged. A failed fetch leaves the field's
 * existing options (typically empty) so the form still opens.
 */
export async function loadFieldOptions(
	fields: IEditFieldDef[],
	api: { fetch(path: string, init?: RequestInit): Promise<Response> }
): Promise<IEditFieldDef[]> {
	return Promise.all(fields.map(async f => {
		if (f.kind !== 'select' || !f.optionsApiPath) { return f; }
		const labelKey = f.optionLabelKey || 'name';
		const valueKey = f.optionValueKey || 'id';
		try {
			const res = await api.fetch(`${f.optionsApiPath}?page=0&size=200`);
			if (!res.ok) { return f; }
			const data = await res.json();
			const wrapper = (data?.data ?? data) as Record<string, unknown> | unknown[];
			const list = (Array.isArray(wrapper) ? wrapper : ((wrapper as Record<string, unknown>)?.content as unknown[]) || []) as Array<Record<string, unknown>>;
			const options = list
				.map(item => {
					const value = item[valueKey];
					if (value === undefined || value === null) { return null; }
					return { value: String(value), label: String(item[labelKey] ?? value) };
				})
				.filter((o): o is { value: string; label: string } => o !== null);
			return { ...f, options };
		} catch {
			return f;
		}
	}));
}

/**
 * Open a theme-aware modal dialog that renders the given field schema as a
 * form. The dialog is built with raw DOM (matches the rest of the workbench
 * sidebar code) and uses the workbench theme class for colours so it looks
 * native on light, dark, and high-contrast themes.
 *
 * Used by every sidebar Edit action so users see the record's fields right
 * away instead of being redirected to the full editor page.
 */
/**
 * Walk up from {@link anchor} until we find the workbench root (the
 * element VS Code stamps with the `monaco-workbench` class). All workbench
 * theme CSS variables — `--vscode-foreground`, `--vscode-input-background`,
 * `--vscode-sideBar-background`, etc. — are scoped under that selector,
 * so any overlay we want to inherit theme colours has to be mounted as
 * one of its descendants.
 *
 * The previous version mounted dialog overlays on `document.body`, which
 * sits OUTSIDE `.monaco-workbench` — so every workbench var resolved to
 * its hardcoded fallback. On a light workbench the fallback was the dark
 * default (`#252526` background, `#cccccc` foreground) and the drawer
 * rendered dark over the light page (QA-flagged on the clinical /
 * operations / system New <X> drawers).
 */
function findWorkbenchRoot(anchor: HTMLElement | undefined, doc: Document): HTMLElement {
	// First: walk up from the anchor. This is the cheapest path and works
	// whenever the dialog is opened from a pane that's currently in the DOM.
	let el: HTMLElement | null | undefined = anchor;
	while (el) {
		if (el.classList && el.classList.contains('monaco-workbench')) { return el; }
		el = el.parentElement;
	}
	// Fallback: query for the workbench root by class. VS Code itself uses
	// this exact lookup in layout.ts when it needs to resolve the workbench
	// container for an auxiliary window. We allow it here because the
	// alternative — mounting on doc.body — leaves the dialog outside the
	// `.monaco-workbench` selector that VS Code uses to scope every
	// workbench CSS variable. That produced the dark drawer on light
	// theme QA flagged on the clinical / operations / system menus.
	// eslint-disable-next-line no-restricted-syntax
	const wb = (doc.body || doc.documentElement).getElementsByClassName('monaco-workbench')[0] as HTMLElement | undefined;
	if (wb) { return wb; }
	return doc.body || doc.documentElement;
}

export function openRecordEditDialog(opts: IEditDialogOptions): void {
	const doc = (opts.themeAnchor && opts.themeAnchor.ownerDocument) || document;
	const theme = detectThemeKind(doc, opts.themeAnchor);
	const palette = THEME_PALETTES[theme];
	// Mount all overlays / popover panels under `.monaco-workbench` so they
	// inherit the workbench theme CSS variables. See {@link findWorkbenchRoot}.
	const workbenchRoot = findWorkbenchRoot(opts.themeAnchor, doc);
	// Use workbench CSS variables for every dialog surface rather than the
	// hardcoded {@link THEME_PALETTES} entry. The detection occasionally
	// falls back to 'dark' when the dialog opens before the theme class
	// lands on a reachable ancestor — which produced a dark drawer overlaid
	// on a light workbench (QA-flagged on the clinical / operations /
	// system menu drawers). CSS variables automatically follow whichever
	// workbench theme is active, so the drawer matches every theme without
	// us needing to detect it. Each token falls back to a sensible default
	// so the dialog still renders if a custom theme leaves a variable
	// undefined. The shadow stays palette-driven because it deepens on dark
	// themes for legibility.
	const colors = {
		background: 'var(--vscode-sideBar-background, var(--vscode-editor-background, #252526))',
		foreground: 'var(--vscode-foreground, #cccccc)',
		border: 'var(--vscode-widget-border, var(--vscode-input-border, rgba(127,127,127,0.4)))',
		shadow: theme === 'light' || theme === 'hcLight' ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.45)',
		separator: 'var(--vscode-editorWidget-border, rgba(128,128,128,0.2))',
		hoverBackground: 'var(--vscode-list-hoverBackground, rgba(128,128,128,0.16))',
		inputBackground: 'var(--vscode-input-background, #1e1e1e)',
		inputBorder: 'var(--vscode-input-border, rgba(127,127,127,0.4))',
		popoverBackground: 'var(--vscode-editorWidget-background, var(--vscode-dropdown-background, var(--vscode-input-background, #1e1e1e)))',
		popoverBorder: 'var(--vscode-widget-border, var(--vscode-editorWidget-border, var(--vscode-input-border, rgba(127,127,127,0.4))))',
	};
	// `palette` is read by a couple of remaining sites for hoverForeground
	// (which has no direct workbench CSS variable equivalent).
	void palette;

	// Popover panels (typeahead matches + custom-select option lists) are
	// mounted directly on document.body so they escape the dialog's transform
	// stacking context and the form's overflow clipping. Track them here so
	// we can detach every panel + its scroll/resize/document listeners when
	// the dialog closes.
	const openPopoverPanels: Array<{ panel: HTMLElement; reposition: () => void; onDocClick?: (e: MouseEvent) => void }> = [];

	// Right-side slide-out drawer (matches the EHR-UI Patient Recall edit
	// flow). The overlay is a thin scrim that lets the underlying page stay
	// visible while preventing accidental clicks; the drawer itself docks
	// flush to the right edge of the workbench.
	// Offset the drawer below the workbench title bar so it doesn't cover the
	// top toolbar (the "Patient / Appointment / Donate" actions + window
	// controls). Measuring the live titlebar keeps us correct across custom /
	// native title-bar styles. QA report issues 30 & 31: "edit page is mis
	// aligned with top bar like patient, appointment etc".
	// eslint-disable-next-line no-restricted-syntax
	const titlebarEl = doc.querySelector('.part.titlebar');
	const titlebarHeight = titlebarEl ? Math.round((titlebarEl as HTMLElement).getBoundingClientRect().height) : 35;

	const isModal = opts.variant === 'modal';

	const overlay = doc.createElement('div');
	overlay.className = 'ciyex-edit-dialog-overlay';
	// Keep the overlay transparent — only the inline rgba(0,0,0,0.25)
	// scrim darkens the workbench underneath. Mounting inside
	// `workbenchRoot` (below) gives the drawer its CSS variables; we do
	// NOT also copy the workbench classList onto the overlay because that
	// turned the entire left half into a solid black panel — the second
	// `.monaco-workbench` element painted over the real workbench content.
	// Modal variant centres the dialog over the workbench instead of
	// docking it to the right edge.
	overlay.style.cssText = isModal
		? `position:fixed;top:${titlebarHeight}px;left:0;right:0;bottom:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);padding:24px;`
		: `position:fixed;top:${titlebarHeight}px;left:0;right:0;bottom:0;z-index:2000;display:flex;align-items:stretch;justify-content:flex-end;background:rgba(0,0,0,0.25);`;

	const dialog = doc.createElement('div');
	dialog.style.cssText = (isModal ? [
		'width:640px',
		'max-width:min(92vw,640px)',
		`max-height:calc(100vh - ${titlebarHeight}px - 48px)`,
		'display:flex',
		'flex-direction:column',
		'overflow:hidden',
		`background:${colors.background}`,
		`color:${colors.foreground}`,
		`border:1px solid ${colors.border}`,
		'border-radius:12px',
		`box-shadow:0 24px 64px ${colors.shadow}`,
		'font-size:13px',
		// Subtle fade + scale matches typical modal entrance.
		'transform:scale(0.96)',
		'opacity:0',
		'transition:transform 0.18s ease-out, opacity 0.18s ease-out',
	] : [
		// 560px matches the editor form drawer (clinicalListEditor `_renderForm`)
		// so the `+` quick-create drawer is the same width as the "New …" form.
		'width:560px',
		'max-width:95vw',
		`height:calc(100vh - ${titlebarHeight}px)`,
		'display:flex',
		'flex-direction:column',
		'overflow:hidden',
		`background:${colors.background}`,
		`color:${colors.foreground}`,
		`border-left:1px solid ${colors.border}`,
		`box-shadow:-12px 0 32px ${colors.shadow}`,
		'font-size:13px',
		// Slide-in animation - matches the React drawer in the web EHR UI.
		'transform:translateX(100%)',
		'transition:transform 0.2s ease-out',
	]).join(';');

	const header = doc.createElement('div');
	// Header padding matches the editor form (`18px 20px 14px`) so the title sits
	// at the same offset in both the `+` drawer and the "New …" editor form.
	header.style.cssText = `padding:18px 20px 14px;border-bottom:1px solid ${colors.separator};font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-shrink:0;`;
	const titleEl = doc.createElement('span');
	titleEl.textContent = opts.title;
	titleEl.style.flex = '1';
	header.appendChild(titleEl);
	const closeBtn = doc.createElement('button');
	closeBtn.type = 'button';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.style.cssText = `background:transparent;border:none;color:${colors.foreground};opacity:0.7;font-size:18px;line-height:1;cursor:pointer;padding:4px 8px;border-radius:4px;`;
	closeBtn.textContent = '×';
	closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = colors.hoverBackground; closeBtn.style.opacity = '1'; });
	closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.opacity = '0.7'; });
	closeBtn.addEventListener('click', () => close());
	header.appendChild(closeBtn);
	dialog.appendChild(header);

	const form = doc.createElement('form');
	// Two-column grid - matches the EHR-UI drawer in image 2. Cells span one
	// column unless the field's widthPct asks for full width.
	// Hide the scrollbar to match the main-page (clinicalListEditor) form
	// drawer — content still scrolls when overflowing, just without the
	// visible scrollbar gutter the QA team flagged.
	form.className = 'ciyex-edit-dialog-body';
	// `padding:20px` + `gap:12px` matches the editor form body (clinicalListEditor
	// `_renderForm`) so the field grid has identical spacing in both forms.
	form.style.cssText = 'padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;overflow-y:auto;flex:1;align-content:start;scrollbar-width:none;-ms-overflow-style:none;';
	const scrollbarStyle = doc.createElement('style');
	scrollbarStyle.textContent = 'form.ciyex-edit-dialog-body::-webkit-scrollbar{display:none;width:0;height:0;}';
	dialog.appendChild(scrollbarStyle);
	form.addEventListener('submit', (e) => { e.preventDefault(); });
	// Disable the browser's native form autofill/autocomplete on the whole
	// form. Without this, Chromium/Edge pop their own (semi-transparent,
	// system-styled) suggestion list below text inputs — that was the
	// "transparent dropdown" the user saw across Prescription, Lab,
	// Tasks, Clinical and every other create/edit drawer.
	form.setAttribute('autocomplete', 'off');

	const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
	const inputBg = colors.inputBackground;
	const inputBorder = colors.inputBorder;
	// Popover (typeahead / custom-select) surfaces use the editor-widget
	// background which is visibly distinct from the drawer surface on every
	// workbench theme, plus a solid border + drop shadow so the popup never
	// blends into the form.
	const popoverBg = colors.popoverBackground;
	const popoverBorder = colors.popoverBorder;
	const popoverShadow = colors.shadow;

	for (const field of opts.fields) {
		const wrap = doc.createElement('div');
		// widthPct >= 75% spans both grid columns - mirrors the editor form,
		// where a field fills the whole row only when it opts into `width:'span 2'`.
		// We deliberately do NOT force every textarea full-width: the editor keeps
		// a span-less textarea (e.g. Patient Recall "Notes") in a single column, so
		// the `+` drawer must too for the two forms to match exactly.
		const widthPct = field.widthPct ?? 100;
		const spanFull = widthPct >= 75;
		wrap.style.cssText = `${spanFull ? 'grid-column:1 / -1;' : ''}display:${field.hidden ? 'none' : 'flex'};flex-direction:column;gap:4px;min-width:0;`;

		const lbl = doc.createElement('label');
		lbl.textContent = field.label + (field.required ? ' *' : '');
		lbl.style.cssText = `font-size:12px;font-weight:500;color:${colors.foreground};opacity:0.8;`;
		wrap.appendChild(lbl);

		const initial = String(opts.values[field.key] ?? '');
		let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
		let searchPanel: HTMLDivElement | null = null;
		if (field.kind === 'textarea') {
			const ta = doc.createElement('textarea');
			// Height is driven by the min-height/max-height set below (mirrors the
			// editor form), so leave rows at the 2-line default rather than forcing 3.
			ta.rows = 2;
			ta.value = initial;
			input = ta;
		} else if (field.kind === 'select') {
			// Native <select> dropdowns can't be reliably styled — Chromium
			// renders the option list using OS chrome which on dark themes
			// produces low-contrast (faint grey) text for non-highlighted
			// options. Build a custom dropdown instead: a hidden <input>
			// holds the value (so the inputs Map / save flow is unchanged)
			// while a button-styled wrapper + body-mounted popover render
			// the option list with full theme control.
			const hidden = doc.createElement('input');
			hidden.type = 'hidden';
			hidden.value = initial;
			input = hidden;
			wrap.appendChild(hidden);

			const trigger = doc.createElement('button');
			trigger.type = 'button';
			trigger.setAttribute('aria-haspopup', 'listbox');
			trigger.setAttribute('aria-expanded', 'false');
			trigger.style.cssText = `display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px;background:${inputBg};color:${colors.foreground};border:1px solid ${inputBorder};border-radius:4px;font-size:13px;font-family:inherit;cursor:pointer;text-align:left;width:100%;`;
			const triggerLabel = doc.createElement('span');
			triggerLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			const triggerCaret = doc.createElement('span');
			// allow-any-unicode-next-line
			triggerCaret.textContent = '▾';
			triggerCaret.style.cssText = `opacity:0.7;font-size:10px;flex-shrink:0;`;
			trigger.appendChild(triggerLabel);
			trigger.appendChild(triggerCaret);
			const findLabel = (val: string): string => {
				const match = (field.options || []).find(o => o.value === val);
				return match ? match.label : (val || field.placeholder || 'Select...');
			};
			const refreshTriggerLabel = () => {
				const v = hidden.value;
				triggerLabel.textContent = findLabel(v);
				triggerLabel.style.opacity = v ? '1' : '0.6';
			};
			refreshTriggerLabel();

			const panel = doc.createElement('div');
			// Mirror every workbench theme class onto the popover panel so
			// `var(--vscode-…)` resolves on the panel itself even when the
			// mount root is body. Without this the panel rendered dark on a
			// light workbench because the CSS variables only exist under
			// `.monaco-workbench`.
			panel.className = 'ciyex-select-panel';
			panel.setAttribute('role', 'listbox');
			// max-height fits the common option lists (e.g. 8 task types) without
			// overflowing, and the scrollbar is hidden (scrollbar-width + the
			// ::-webkit-scrollbar rule in ciyexCommon.css) so the sidebar "+ New
			// Task" Task Type dropdown no longer shows a vertical scrollbar.
			// Scrollbar styling (thin, themed, visible) comes from the
			// `.ciyex-select-panel` rule in ciyexCommon.css so long option lists
			// (Category / Location / Supplier) advertise that they scroll.
			panel.style.cssText = `position:fixed;background-color:${popoverBg};color:${colors.foreground};border:1px solid ${popoverBorder};border-radius:4px;box-shadow:0 6px 18px ${popoverShadow};z-index:10000;max-height:320px;overflow-y:auto;display:none;`;
			workbenchRoot.appendChild(panel);

			const positionSelectPanel = () => {
				const rect = trigger.getBoundingClientRect();
				panel.style.left = `${rect.left}px`;
				panel.style.top = `${rect.bottom + 2}px`;
				panel.style.minWidth = `${rect.width}px`;
			};
			const renderSelectOptions = () => {
				DOM.clearNode(panel);
				for (const opt of field.options || []) {
					const row = doc.createElement('div');
					row.setAttribute('role', 'option');
					const isSelected = opt.value === hidden.value;
					row.style.cssText = `padding:7px 10px;cursor:pointer;font-size:13px;border-bottom:1px solid ${colors.separator};background-color:${isSelected ? colors.hoverBackground : popoverBg};color:${colors.foreground};${isSelected ? 'font-weight:500;' : ''}`;
					row.textContent = opt.label;
					row.addEventListener('mouseenter', () => { row.style.backgroundColor = colors.hoverBackground; });
					row.addEventListener('mouseleave', () => { row.style.backgroundColor = opt.value === hidden.value ? colors.hoverBackground : popoverBg; });
					row.addEventListener('mousedown', (e) => {
						e.preventDefault();
						// Contain the selection to this control so the host drawer's
						// outside-click handler doesn't see it.
						e.stopPropagation();
						hidden.value = opt.value;
						refreshTriggerLabel();
						closePanel();
						// closePanel() hides this body-mounted panel during mousedown,
						// so the trailing synthetic `click` resolves to the drawer's
						// overlay scrim (onOverlayClick → close()), tearing the drawer
						// down before save. Swallow exactly that one click.
						const swallowNextClick = (ev: Event) => {
							ev.stopPropagation();
							ev.preventDefault();
							doc.removeEventListener('click', swallowNextClick, true);
						};
						doc.addEventListener('click', swallowNextClick, true);
						doc.defaultView?.setTimeout(() => doc.removeEventListener('click', swallowNextClick, true), 100);
					});
					panel.appendChild(row);
				}
			};
			let panelOpen = false;
			const openPanel = () => {
				renderSelectOptions();
				positionSelectPanel();
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
			trigger.addEventListener('focus', () => { trigger.style.borderColor = 'var(--vscode-focusBorder, #007fd4)'; });
			trigger.addEventListener('blur', () => { trigger.style.borderColor = inputBorder; });
			const onDocClick = (e: MouseEvent) => {
				if (!panelOpen) { return; }
				const target = e.target as Node | null;
				if (target && (panel.contains(target) || trigger.contains(target))) { return; }
				closePanel();
			};
			doc.addEventListener('mousedown', onDocClick, true);
			const reposition = () => { if (panelOpen) { positionSelectPanel(); } };
			doc.defaultView?.addEventListener('scroll', reposition, true);
			doc.defaultView?.addEventListener('resize', reposition);
			openPopoverPanels.push({ panel, reposition, onDocClick });

			wrap.appendChild(trigger);
			inputs.set(field.key, hidden);
			if (field.hint) {
				const hint = doc.createElement('div');
				hint.textContent = field.hint;
				hint.style.cssText = `font-size:11px;color:${colors.foreground};opacity:0.6;`;
				wrap.appendChild(hint);
			}
			form.appendChild(wrap);
			continue;
		} else if (field.kind === 'time') {
			// Custom HH:MM dropdown instead of <input type="time">: the native
			// time picker can't be reliably closed in the Electron workbench
			// (blur() is a no-op), so it stayed open after a selection. The
			// custom dropdown commits + closes deterministically on minute pick.
			const hidden = createTimeDropdown({
				parent: wrap,
				initialValue: initial,
				placeholder: field.placeholder || 'Select time...',
			});
			inputs.set(field.key, hidden);
			if (field.hint) {
				const hint = doc.createElement('div');
				hint.textContent = field.hint;
				hint.style.cssText = `font-size:11px;color:${colors.foreground};opacity:0.6;`;
				wrap.appendChild(hint);
			}
			form.appendChild(wrap);
			continue;
		} else if (field.kind === 'date') {
			// MM/DD/YYYY masked text + calendar picker instead of a native
			// <input type="date">: the native picker renders in OS-locale order on
			// Linux Electron and lets the year grow past 4 digits (6-digit-year bug)
			// and never auto-inserts slashes. The hidden input carries the ISO value.
			const dateCss = `padding:6px 8px;background:${inputBg};color:${colors.foreground};border:1px solid ${inputBorder};border-radius:4px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;width:100%;`;
			const { hidden } = createUsDateField(doc, wrap, initial, dateCss, colors.foreground);
			inputs.set(field.key, hidden);
			if (field.hint) {
				const hint = doc.createElement('div');
				hint.textContent = field.hint;
				hint.style.cssText = `font-size:11px;color:${colors.foreground};opacity:0.6;`;
				wrap.appendChild(hint);
			}
			form.appendChild(wrap);
			continue;
		} else if (field.kind === 'search') {
			// Typeahead — text input with a dropdown panel for matches.
			//
			// The panel is mounted on `document.body` (not inside the wrap)
			// with `position:fixed` so it escapes the dialog's `transform`
			// stacking context AND the form's `overflow-y:auto` clipping.
			// Both were causing the panel to look transparent in earlier
			// attempts: transforms create a new stacking context (z-index
			// can't escape it), and overflow:auto clips absolutely-positioned
			// descendants. Mounting on body sidesteps both.
			const inp = doc.createElement('input');
			inp.type = 'text';
			inp.value = initial;
			inp.autocomplete = 'off';
			input = inp;
			searchPanel = doc.createElement('div');
			// Mirror workbench theme classes onto the typeahead panel so the
			// `var(--vscode-…)` lookups resolve on the panel itself.
			searchPanel.className = 'ciyex-typeahead-panel';
			// `position:fixed` so the panel is positioned against the viewport
			// — we set top/left explicitly from the input's getBoundingClientRect
			// when results are shown. z-index:10000 keeps it above the dialog
			// overlay (z-index:2000) and any subsequent floating UI.
			searchPanel.style.cssText = `position:fixed;background-color:${popoverBg};color:${colors.foreground};border:1px solid ${popoverBorder};border-radius:4px;box-shadow:0 6px 18px ${popoverShadow};z-index:10000;max-height:240px;overflow-y:auto;display:none;`;
			// Mount inside the workbench so the panel paints against the
			// workbench root's stacking context (ignoring every transform /
			// overflow / opacity ancestor it would otherwise inherit from).
			workbenchRoot.appendChild(searchPanel);
		} else {
			const inp = doc.createElement('input');
			inp.type = field.kind || 'text';
			inp.value = initial;
			input = inp;
		}
		// Suppress the browser-native autocomplete dropdown on every text-like
		// input. Chromium ignores plain `autocomplete="off"` when a field's
		// name/id matches a known autofill heuristic (email, address, name,
		// etc.), so we layer:
		//   1. `autocomplete="new-password"` — Chrome treats this token specially
		//      and explicitly suppresses both autofill *and* the suggestion popup.
		//   2. A randomised `name` so Chromium's heuristic name-matcher misses.
		//   3. `aria-autocomplete="none"` — turns off the suggestion popup at
		//      the accessibility layer (some Chromium versions read this).
		//   4. The `readonly` trick — start the input read-only and clear the
		//      attribute the first time the user focuses it. Chromium decides
		//      whether to offer autofill at *focus* time; if it sees a
		//      readonly input it skips the field entirely, and removing the
		//      attribute right after focus doesn't re-trigger the check.
		if (DOM.isHTMLInputElement(input) || DOM.isHTMLTextAreaElement(input)) {
			input.setAttribute('autocomplete', 'new-password');
			input.setAttribute('autocorrect', 'off');
			input.setAttribute('autocapitalize', 'off');
			input.setAttribute('spellcheck', 'false');
			input.setAttribute('aria-autocomplete', 'none');
			input.setAttribute('name', `ciyex-${field.key}-${Math.random().toString(36).slice(2, 8)}`);
			// `readonly` trick — must NOT block our own search-typeahead
			// listeners, so we attach a one-shot focus handler that drops the
			// attribute before the user types the first character.
			// 'time' and 'date' are handled earlier via their own branches; here
			// search fields manage their own readonly state.
			if (field.readonly) {
				// Genuinely read-only (derived) field — keep it non-editable.
				// Do NOT attach the autofill-release handlers below (styling is
				// applied after the cssText assignment further down).
				input.setAttribute('readonly', 'readonly');
			} else if (field.kind !== 'search') {
				// Search fields manage their own readonly state (locked after a
				// dropdown pick), so they must not get the autofill-release trick —
				// otherwise focusing a locked selection would silently unlock it.
				input.setAttribute('readonly', 'readonly');
				const releaseReadonly = () => { input.removeAttribute('readonly'); };
				input.addEventListener('focus', releaseReadonly, { once: true });
				input.addEventListener('pointerdown', releaseReadonly, { once: true });
			}
		}
		input.style.cssText = `padding:6px 8px;background:${inputBg};color:${colors.foreground};border:1px solid ${inputBorder};border-radius:4px;font-size:13px;font-family:inherit;outline:none;box-sizing:border-box;width:100%;`;
		if (DOM.isHTMLTextAreaElement(input)) {
			// Match the editor form's textarea sizing (clinicalListEditor
			// `_renderForm`): two visible lines, drag-resizable, capped height — so
			// the `+` drawer's Notes box is the same as the "New …" form's.
			input.style.minHeight = '40px';
			input.style.maxHeight = '120px';
			input.style.resize = 'vertical';
		}
		if (field.readonly) {
			// Dim derived/auto-calculated fields (e.g. BMI) so they read as
			// non-editable — matches the chart editor's BMI styling.
			input.style.background = 'rgba(128,128,128,0.06)';
			input.style.opacity = '0.85';
			input.style.cursor = 'default';
		}
		if (field.placeholder && (DOM.isHTMLInputElement(input) || DOM.isHTMLTextAreaElement(input))) {
			input.placeholder = field.placeholder;
		}
		// Digit cap for tel / number fields (e.g. fax number <= 12 digits). Strip
		// any digit typed past the limit so the field can never hold more than
		// `maxDigits` — the on-save check below also rejects under-length values.
		if (field.maxDigits && DOM.isHTMLInputElement(input)) {
			const maxDigits = field.maxDigits;
			const capped = input as HTMLInputElement;
			capped.addEventListener('input', () => {
				const digits = capped.value.replace(/\D/g, '');
				if (digits.length > maxDigits) {
					// Re-emit the kept formatting characters but drop the excess
					// digits — keep only the first `maxDigits` digits, preserving
					// the user's separators up to that point.
					let kept = '';
					let count = 0;
					for (const ch of capped.value) {
						if (/\d/.test(ch)) {
							if (count >= maxDigits) { continue; }
							count++;
						}
						kept += ch;
					}
					capped.value = kept;
				}
			});
		}
		input.addEventListener('focus', () => {
			input.style.borderColor = 'var(--vscode-focusBorder, #007fd4)';
		});
		input.addEventListener('blur', () => {
			input.style.borderColor = inputBorder;
		});
		wrap.appendChild(input);
		inputs.set(field.key, input);

		// Wire up search-typeahead behaviour once both the input and panel exist.
		if (field.kind === 'search' && searchPanel && field.onSearch) {
			const panel = searchPanel;
			const onSearch = field.onSearch;
			const onSelect = field.onSelectSearchResult;
			const inputEl = input as HTMLInputElement;
			// Lock to a value picked from the results by default — free-typed text
			// that isn't selected (e.g. a provider not in the list) is wiped on
			// blur and rejected on save (opt out per-field with strictSelect:false).
			const strict = field.strictSelect !== false;
			// After a pick the field becomes read-only (non-editable) with a clear to
			// clear and search again — so a selected name can't be edited into
			// something that no longer matches the chosen record.
			let setLocked: ((locked: boolean) => void) | undefined;
			if (strict) {
				const holder = doc.createElement('span');
				holder.style.cssText = 'position:relative;display:block;';
				inputEl.parentElement?.insertBefore(holder, inputEl);
				holder.appendChild(inputEl);
				inputEl.style.paddingRight = '24px';
				const clearBtn = doc.createElement('span');
				clearBtn.textContent = '\u2715';
				clearBtn.title = 'Clear selection';
				clearBtn.style.cssText = `position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:12px;color:${colors.foreground};opacity:0.6;display:none;line-height:1;`;
				holder.appendChild(clearBtn);
				setLocked = (locked: boolean): void => {
					inputEl.readOnly = locked;
					inputEl.dataset.selected = locked ? '1' : '';
					clearBtn.style.display = locked ? 'block' : 'none';
				};
				clearBtn.addEventListener('mousedown', (e) => {
					e.preventDefault(); e.stopPropagation();
					setLocked!(false);
					inputEl.value = '';
					inputEl.focus();
				});
				// An existing record's saved value counts as an already-confirmed pick.
				if (inputEl.value.trim()) { setLocked(true); }
			}
			let debounceHandle: ReturnType<typeof setTimeout> | undefined;
			// Position the panel directly under the input every time it
			// reopens. Using `position:fixed` against viewport coordinates
			// sidesteps the form's `overflow-y:auto` clipping and the
			// dialog's `transform` stacking context.
			const positionPanel = () => {
				const rect = inputEl.getBoundingClientRect();
				panel.style.left = `${rect.left}px`;
				panel.style.top = `${rect.bottom + 2}px`;
				panel.style.width = `${rect.width}px`;
			};
			const renderResults = (results: Array<{ value: string; label: string; description?: string; details?: Record<string, string> }>) => {
				DOM.clearNode(panel);
				if (results.length === 0) { panel.style.display = 'none'; return; }
				for (const r of results) {
					const opt = doc.createElement('div');
					// Each row carries its own opaque theme background so the
					// dropdown reads as a solid surface — without this the
					// rows inherited from the panel only, and any compositor
					// quirk could let the form below show through.
					opt.style.cssText = `padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid ${colors.separator};background-color:${popoverBg};color:${colors.foreground};`;
					const label = doc.createElement('div');
					label.textContent = r.label;
					label.style.fontWeight = '500';
					opt.appendChild(label);
					if (r.description) {
						const desc = doc.createElement('div');
						desc.textContent = r.description;
						desc.style.cssText = `font-size:11px;opacity:0.7;`;
						opt.appendChild(desc);
					}
					opt.addEventListener('mouseenter', () => { opt.style.backgroundColor = colors.hoverBackground; });
					opt.addEventListener('mouseleave', () => { opt.style.backgroundColor = popoverBg; });
					opt.addEventListener('mousedown', (e) => {
						e.preventDefault();
						e.stopPropagation();
						inputEl.value = r.label;
						if (setLocked) { setLocked(true); } else { inputEl.dataset.selected = '1'; }
						if (onSelect) { onSelect(r, inputs); }
						panel.style.display = 'none';
						// Hiding this body-mounted panel during mousedown makes the
						// trailing synthetic click resolve to the drawer's overlay
						// scrim (onOverlayClick → close()), closing the form before
						// save. Swallow that one click.
						const swallowNextClick = (ev: Event) => {
							ev.stopPropagation();
							ev.preventDefault();
							doc.removeEventListener('click', swallowNextClick, true);
						};
						doc.addEventListener('click', swallowNextClick, true);
						doc.defaultView?.setTimeout(() => doc.removeEventListener('click', swallowNextClick, true), 100);
					});
					panel.appendChild(opt);
				}
				positionPanel();
				panel.style.display = 'block';
			};
			// Re-position on scroll/resize so the panel tracks the input if
			// the user scrolls the form body or resizes the window.
			const reposition = () => { if (panel.style.display === 'block') { positionPanel(); } };
			doc.defaultView?.addEventListener('scroll', reposition, true);
			doc.defaultView?.addEventListener('resize', reposition);
			inputEl.addEventListener('input', () => {
				// Typing invalidates a prior selection until a new result is picked.
				if (strict) { inputEl.dataset.selected = ''; }
				const q = inputEl.value.trim();
				if (debounceHandle) { clearTimeout(debounceHandle); }
				if (q.length < 2) { panel.style.display = 'none'; return; }
				debounceHandle = setTimeout(async () => {
					try {
						const results = await onSearch(q);
						renderResults(results.slice(0, 8));
					} catch { panel.style.display = 'none'; }
				}, 250);
			});
			inputEl.addEventListener('blur', () => {
				// Hide after a tick so click on a result still fires
				setTimeout(() => {
					panel.style.display = 'none';
					// Drop text that was never confirmed against the list.
					if (strict && inputEl.dataset.selected !== '1' && inputEl.value) { inputEl.value = ''; }
				}, 150);
			});
			// Track the panel for cleanup when the dialog closes — see the
			// `close()` helper below.
			openPopoverPanels.push({ panel, reposition });
		}

		if (field.hint) {
			const hint = doc.createElement('div');
			hint.textContent = field.hint;
			hint.style.cssText = `font-size:11px;color:${colors.foreground};opacity:0.6;`;
			wrap.appendChild(hint);
		}

		form.appendChild(wrap);
	}

	// Derived fields: recompute every `compute` field from the current values
	// whenever any input changes (and once now, so editing an existing record
	// refreshes a stale value). Mirrors the chart editor's BMI auto-calc.
	const computeFields = opts.fields.filter(f => typeof f.compute === 'function');
	if (computeFields.length > 0) {
		const recomputeDerived = () => {
			const current: Record<string, string> = {};
			inputs.forEach((el, k) => { current[k] = el.value; });
			for (const f of computeFields) {
				const target = inputs.get(f.key);
				if (target) { target.value = f.compute!(current); }
			}
		};
		form.addEventListener('input', recomputeDerived);
		recomputeDerived();
	}

	// Composite sections (e.g. Care Plans Goals / Interventions) mirror the full
	// editor's formExtras hook, so the drawer collects the same nested payload.
	// Rendered inside the form grid so it scrolls with the fields above it.
	let extrasHandle: { collect: () => Record<string, unknown> } | null = null;
	if (opts.formExtras) {
		const extrasHost = doc.createElement('div');
		extrasHost.style.cssText = 'grid-column:1 / -1;';
		form.appendChild(extrasHost);
		extrasHandle = opts.formExtras(extrasHost, opts.values);
	}

	dialog.appendChild(form);

	const footer = doc.createElement('div');
	footer.style.cssText = `padding:14px 22px;border-top:1px solid ${colors.separator};display:flex;justify-content:flex-end;gap:8px;flex-shrink:0;`;

	const errorMsg = doc.createElement('span');
	errorMsg.style.cssText = `flex:1;color:#ef4444;font-size:12px;align-self:center;`;
	footer.appendChild(errorMsg);

	const cancelBtn = doc.createElement('button');
	cancelBtn.type = 'button';
	cancelBtn.textContent = 'Cancel';
	cancelBtn.style.cssText = `padding:6px 14px;border:1px solid ${colors.border};border-radius:4px;background:transparent;color:${colors.foreground};font-size:13px;cursor:pointer;`;
	cancelBtn.addEventListener('click', () => close());
	footer.appendChild(cancelBtn);

	const saveBtn = doc.createElement('button');
	saveBtn.type = 'button';
	saveBtn.textContent = opts.primaryLabel || 'Save Changes';
	saveBtn.style.cssText = 'padding:6px 14px;border:none;border-radius:4px;background:var(--vscode-button-background, #0e639c);color:var(--vscode-button-foreground, #ffffff);font-size:13px;font-weight:500;cursor:pointer;';
	saveBtn.addEventListener('mouseenter', () => { saveBtn.style.background = 'var(--vscode-button-hoverBackground, #1177bb)'; });
	saveBtn.addEventListener('mouseleave', () => { saveBtn.style.background = 'var(--vscode-button-background, #0e639c)'; });
	saveBtn.addEventListener('click', async () => {
		errorMsg.textContent = '';
		const result: Record<string, string> = {};
		for (const f of opts.fields) {
			const inputEl = inputs.get(f.key);
			const v = inputEl?.value ?? '';
			// strictSelect: a search value typed but not picked from the results
			// (e.g. Save clicked before the blur-clear fires) must not be saved.
			if (f.kind === 'search' && f.strictSelect !== false && v.trim() && inputEl?.dataset.selected !== '1') {
				if (inputEl) { inputEl.value = ''; }
				errorMsg.textContent = `Please select ${f.label} from the search results`;
				return;
			}
			if (f.required && !v.trim()) {
				errorMsg.textContent = `${f.label} is required`;
				return;
			}
			// Digit-count constraints (e.g. fax number must be exactly 12 digits).
			if ((f.minDigits || f.maxDigits) && v.trim()) {
				const digitCount = v.replace(/\D/g, '').length;
				if (f.maxDigits && digitCount > f.maxDigits) {
					errorMsg.textContent = `${f.label} must be at most ${f.maxDigits} digits`;
					return;
				}
				if (f.minDigits && digitCount < f.minDigits) {
					errorMsg.textContent = f.minDigits === f.maxDigits
						? `${f.label} must be exactly ${f.minDigits} digits`
						: `${f.label} must be at least ${f.minDigits} digits`;
					return;
				}
			}
			result[f.key] = v;
		}
		// Merge composite-section data (Goals / Interventions, …) so the saved
		// payload matches the full editor form exactly.
		const payload: Record<string, unknown> = { ...result };
		if (extrasHandle) { Object.assign(payload, extrasHandle.collect()); }
		saveBtn.disabled = true;
		const original = saveBtn.textContent;
		saveBtn.textContent = 'Saving...';
		try {
			await opts.onSave(payload);
			close();
		} catch (err) {
			errorMsg.textContent = err instanceof Error ? err.message : String(err);
			saveBtn.disabled = false;
			saveBtn.textContent = original;
		}
	});
	footer.appendChild(saveBtn);
	dialog.appendChild(footer);
	overlay.appendChild(dialog);

	const onKey = (e: KeyboardEvent) => {
		if (e.key === 'Escape') { close(); }
	};
	const onOverlayClick = (e: MouseEvent) => {
		if (e.target === overlay) { close(); }
	};
	const close = () => {
		if (!overlay.parentElement) { return; }
		overlay.parentElement.removeChild(overlay);
		doc.removeEventListener('keydown', onKey, true);
		overlay.removeEventListener('click', onOverlayClick);
		// Detach every body-mounted typeahead / custom-select panel along
		// with its scroll/resize/document listeners. Leaving them attached
		// would leak listeners on every dialog open and leave stale panels
		// in the DOM tree.
		for (const t of openPopoverPanels) {
			doc.defaultView?.removeEventListener('scroll', t.reposition, true);
			doc.defaultView?.removeEventListener('resize', t.reposition);
			if (t.onDocClick) { doc.removeEventListener('mousedown', t.onDocClick, true); }
			if (t.panel.parentElement) { t.panel.parentElement.removeChild(t.panel); }
		}
		openPopoverPanels.length = 0;
	};
	doc.addEventListener('keydown', onKey, true);
	overlay.addEventListener('click', onOverlayClick);
	workbenchRoot.appendChild(overlay);

	// Defer the transform reset by one frame so the browser registers the
	// initial translateX(100%) before transitioning to 0 - otherwise the
	// drawer just snaps in. Modal variant fades + scales instead.
	const win = DOM.getWindow(opts.themeAnchor || overlay) || mainWindow;
	win.requestAnimationFrame(() => {
		if (isModal) {
			dialog.style.transform = 'scale(1)';
			dialog.style.opacity = '1';
		} else {
			dialog.style.transform = 'translateX(0)';
		}
	});

	const first = opts.fields.length > 0 ? inputs.get(opts.fields[0].key) : undefined;
	first?.focus();
}

// ---------------------------------------------------------------------------
// Unified list + create/edit popup
// ---------------------------------------------------------------------------

export interface IListColumn {
	key: string;
	label: string;
	width?: string;
	format?: (val: unknown, row: Record<string, unknown>) => string;
}

export interface IListAndFormDialogOptions {
	title: string;
	themeAnchor?: HTMLElement;
	fields: IEditFieldDef[];
	listColumns: IListColumn[];
	loadList: () => Promise<Array<Record<string, unknown>>>;
	saveRecord: (values: Record<string, string>, existingId?: string) => Promise<void>;
	deleteRecord?: (id: string) => Promise<void>;
	/** Resolve the id off a row. Defaults to row.id ?? row.fhirId. */
	getRowId?: (row: Record<string, unknown>) => string;
	initialMode?: 'list' | 'create' | 'edit';
	/** Required when initialMode is 'edit' — opens the form pre-populated with this row. */
	initialItem?: Record<string, unknown>;
	primaryLabel?: string;
	onChanged?: () => void;
	/** Close the dialog after a successful save instead of returning to the list
	 *  view. Used for focused single-record edits (e.g. the snapshot's edit-pencil)
	 *  where bouncing back to the full list after saving is unwanted. */
	closeOnSave?: boolean;
}

/** Field-group sections for the unified list/form popup. Clinical forms (the
 *  encounter composition especially) carry dozens of fields whose keys share a
 *  domain prefix — grouping them under labelled sections turns an overwhelming
 *  flat wall of inputs into a scannable, sectioned chart note. Simple resources
 *  (payment, vitals, problem) have no matching prefixes, so they collapse into
 *  a single headerless block and render exactly as a clean two-column form. */
const LIST_FORM_SECTIONS: ReadonlyArray<{ readonly test: RegExp; readonly title: string; readonly icon: string }> = [
	{ test: /^hpi_/, title: 'History of Present Illness', icon: 'history' },
	{ test: /^ros_/, title: 'Review of Systems', icon: 'checklist' },
	{ test: /^vitals_/, title: 'Vitals', icon: 'pulse' },
	{ test: /^pe_/, title: 'Physical Exam', icon: 'person' },
	{ test: /^pmh_/, title: 'Past Medical & Surgical History', icon: 'archive' },
	{ test: /^fh_/, title: 'Family History', icon: 'organization' },
	{ test: /^sh_/, title: 'Social History', icon: 'globe' },
	{ test: /^assessment_/, title: 'Assessment & Diagnosis', icon: 'lightbulb' },
	{ test: /^plan_/, title: 'Plan', icon: 'list-ordered' },
	{ test: /^provider_/, title: 'Provider Notes', icon: 'edit' },
	{ test: /^procedures_/, title: 'Procedures', icon: 'tools' },
];

function sectionForField(key: string): { title: string; icon: string } | null {
	for (const s of LIST_FORM_SECTIONS) {
		if (s.test.test(key)) { return { title: s.title, icon: s.icon }; }
	}
	return null;
}

/** Pick a header glyph for the popup based on the resource title. Falls back to
 *  a neutral list icon so an unmapped entity still gets a tidy badge. */
function listFormHeaderIcon(title: string): string {
	const t = title.toLowerCase();
	if (t.includes('vital')) { return 'pulse'; }
	if (t.includes('problem')) { return 'stethoscope'; }
	if (t.includes('medication')) { return 'symbol-method'; }
	if (t.includes('insurance')) { return 'shield'; }
	if (t.includes('lab')) { return 'beaker'; }
	if (t.includes('payment') || t.includes('financ')) { return 'credit-card'; }
	if (t.includes('statement')) { return 'file-symlink-file'; }
	if (t.includes('claim')) { return 'file-binary'; }
	if (t.includes('encounter')) { return 'note'; }
	if (t.includes('visit')) { return 'calendar'; }
	if (t.includes('demographic')) { return 'account'; }
	return 'list-flat';
}

/**
 * Open a single centred popup that toggles between a list view (existing
 * records with edit + delete actions and a `+ Add` button) and a form view
 * (create / edit). Switching modes never closes the popup — the same overlay
 * is reused, so users perceive one unified surface for managing the resource.
 *
 * The surface is a refined, theme-aware clinical sheet: an accent rail, an
 * icon-badged header with a contextual subtitle, sectioned form fields, custom
 * theme-styled selects + typeahead, focus rings, and a sticky action bar.
 */
export function openListAndFormDialog(opts: IListAndFormDialogOptions): void {
	const doc = (opts.themeAnchor && opts.themeAnchor.ownerDocument) || document;
	const theme = detectThemeKind(doc, opts.themeAnchor);
	const workbenchRoot = findWorkbenchRoot(opts.themeAnchor, doc);

	const getRowId = opts.getRowId || ((r: Record<string, unknown>) => String(r.id ?? r.fhirId ?? ''));
	const headerIcon = listFormHeaderIcon(opts.title);
	const singular = opts.title.replace(/s$/, '') || opts.title;

	// Theme-driven surface tokens — every colour resolves from workbench CSS
	// variables so the sheet matches light, dark and high-contrast themes
	// automatically (see openRecordEditDialog for the rationale).
	const c = {
		surface: 'var(--vscode-editor-background)',
		raised: 'var(--vscode-editorWidget-background, rgba(127,127,127,0.045))',
		fg: 'var(--vscode-editor-foreground, #ccc)',
		muted: 'var(--vscode-descriptionForeground, rgba(160,160,160,0.9))',
		border: 'var(--vscode-editorWidget-border, rgba(127,127,127,0.28))',
		inputBg: 'var(--vscode-input-background, #1e1e1e)',
		inputBorder: 'var(--vscode-input-border, rgba(127,127,127,0.4))',
		hover: 'var(--vscode-list-hoverBackground, rgba(127,127,127,0.12))',
		accent: 'var(--vscode-focusBorder, var(--vscode-button-background, #0e639c))',
		popoverBg: 'var(--vscode-editorWidget-background, var(--vscode-dropdown-background, #1e1e1e))',
		shadow: theme === 'light' || theme === 'hcLight' ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.5)',
	};

	// Body-mounted popover panels (custom selects + typeahead) — tracked so we
	// detach them and their listeners when the sheet closes.
	const popovers: Array<{ panel: HTMLElement; reposition: () => void; onDocMouseDown?: (e: MouseEvent) => void }> = [];

	// eslint-disable-next-line no-restricted-syntax
	const titlebarEl = doc.querySelector('.part.titlebar');
	const titlebarHeight = titlebarEl ? Math.round((titlebarEl as HTMLElement).getBoundingClientRect().height) : 35;

	const overlay = doc.createElement('div');
	overlay.className = 'ciyex-edit-dialog-overlay';
	overlay.style.cssText = `position:fixed;top:${titlebarHeight}px;left:0;right:0;bottom:0;z-index:2000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);backdrop-filter:blur(1.5px);padding:24px;`;

	const dialog = doc.createElement('div');
	dialog.style.cssText = [
		'width:820px',
		'max-width:min(96vw,820px)',
		`max-height:calc(100vh - ${titlebarHeight}px - 40px)`,
		'display:flex',
		'flex-direction:column',
		'overflow:hidden',
		`background:${c.surface}`,
		`color:${c.fg}`,
		`border:1px solid ${c.border}`,
		'border-radius:14px',
		`box-shadow:0 32px 80px ${c.shadow}, 0 2px 8px ${c.shadow}`,
		'font-size:13px',
		'transform:scale(0.97) translateY(6px)',
		'opacity:0',
		'transition:transform 0.2s cubic-bezier(0.16,1,0.3,1), opacity 0.2s ease-out',
	].join(';');

	// Accent rail across the very top of the sheet.
	const rail = doc.createElement('div');
	rail.style.cssText = `height:3px;flex-shrink:0;background:linear-gradient(90deg,${c.accent},transparent 92%);`;
	dialog.appendChild(rail);

	const header = doc.createElement('div');
	header.style.cssText = `padding:16px 22px;border-bottom:1px solid ${c.border};display:flex;align-items:center;gap:13px;flex-shrink:0;`;

	const badge = doc.createElement('div');
	badge.style.cssText = `width:38px;height:38px;border-radius:10px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, ${c.accent} 16%, transparent);border:1px solid color-mix(in srgb, ${c.accent} 32%, transparent);`;
	const badgeIco = doc.createElement('span');
	badgeIco.className = `codicon codicon-${headerIcon}`;
	badgeIco.style.cssText = `font-size:18px;color:${c.accent};`;
	badge.appendChild(badgeIco);
	header.appendChild(badge);

	const headText = doc.createElement('div');
	headText.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;';
	const titleEl = doc.createElement('span');
	titleEl.style.cssText = `font-size:16px;font-weight:650;letter-spacing:-0.01em;color:${c.fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
	const subtitleEl = doc.createElement('span');
	subtitleEl.style.cssText = `font-size:11.5px;color:${c.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
	headText.appendChild(titleEl);
	headText.appendChild(subtitleEl);
	header.appendChild(headText);

	const addBtn = doc.createElement('button');
	addBtn.type = 'button';
	addBtn.style.cssText = `padding:7px 14px;border:none;border-radius:8px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background 0.12s;`;
	addBtn.addEventListener('mouseenter', () => { addBtn.style.background = 'var(--vscode-button-hoverBackground,#1177bb)'; });
	addBtn.addEventListener('mouseleave', () => { addBtn.style.background = 'var(--vscode-button-background,#0e639c)'; });
	const addBtnIco = doc.createElement('span');
	addBtnIco.className = 'codicon codicon-add';
	addBtnIco.style.fontSize = '14px';
	addBtn.appendChild(addBtnIco);
	const addBtnLbl = doc.createElement('span');
	addBtnLbl.textContent = 'New';
	addBtn.appendChild(addBtnLbl);
	header.appendChild(addBtn);

	const closeBtn = doc.createElement('button');
	closeBtn.type = 'button';
	closeBtn.setAttribute('aria-label', 'Close');
	closeBtn.style.cssText = `width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:8px;color:${c.fg};opacity:0.65;cursor:pointer;`;
	const closeIco = doc.createElement('span');
	closeIco.className = 'codicon codicon-close';
	closeIco.style.fontSize = '15px';
	closeBtn.appendChild(closeIco);
	closeBtn.addEventListener('mouseenter', () => { closeBtn.style.opacity = '1'; closeBtn.style.background = c.hover; closeBtn.style.borderColor = c.border; });
	closeBtn.addEventListener('mouseleave', () => { closeBtn.style.opacity = '0.65'; closeBtn.style.background = 'transparent'; closeBtn.style.borderColor = 'transparent'; });
	header.appendChild(closeBtn);
	dialog.appendChild(header);

	// Body holds the list / form views. Only one is visible at a time.
	const body = doc.createElement('div');
	body.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:320px;';
	dialog.appendChild(body);

	overlay.appendChild(dialog);

	let currentMode: 'list' | 'form' = 'list';
	let editingItem: Record<string, unknown> | null = null;
	let listRows: Array<Record<string, unknown>> = [];
	let listLoaded = false;

	const teardownPopovers = (): void => {
		for (const p of popovers) {
			doc.defaultView?.removeEventListener('scroll', p.reposition, true);
			doc.defaultView?.removeEventListener('resize', p.reposition);
			if (p.onDocMouseDown) { doc.removeEventListener('mousedown', p.onDocMouseDown, true); }
			p.panel.remove();
		}
		popovers.length = 0;
	};

	const close = (): void => {
		if (!overlay.parentElement) { return; }
		overlay.parentElement.removeChild(overlay);
		doc.removeEventListener('keydown', onKey, true);
		overlay.removeEventListener('click', onOverlayClick);
		teardownPopovers();
	};
	const onKey = (e: KeyboardEvent): void => {
		if (e.key === 'Escape') { close(); }
	};
	const onOverlayClick = (e: MouseEvent): void => {
		if (e.target === overlay) { close(); }
	};

	const renderList = async (): Promise<void> => {
		teardownPopovers();
		currentMode = 'list';
		editingItem = null;
		titleEl.textContent = opts.title;
		addBtn.style.display = '';
		body.replaceChildren();

		const toolbar = doc.createElement('div');
		toolbar.style.cssText = `padding:12px 22px;border-bottom:1px solid ${c.border};display:flex;align-items:center;gap:8px;flex-shrink:0;`;
		const searchWrap = doc.createElement('div');
		searchWrap.style.cssText = `flex:1;display:flex;align-items:center;gap:8px;padding:7px 11px;border:1px solid ${c.inputBorder};border-radius:9px;background:${c.inputBg};transition:border-color 0.12s,box-shadow 0.12s;`;
		const searchIco = doc.createElement('span');
		searchIco.className = 'codicon codicon-search';
		searchIco.style.cssText = `font-size:13px;color:${c.muted};flex-shrink:0;`;
		searchWrap.appendChild(searchIco);
		const search = doc.createElement('input') as HTMLInputElement;
		search.type = 'text';
		search.placeholder = `Filter ${opts.title.toLowerCase()}…`;
		search.autocomplete = 'off';
		search.style.cssText = `flex:1;border:none;background:transparent;color:var(--vscode-input-foreground);outline:none;font-size:12.5px;min-width:0;`;
		searchWrap.appendChild(search);
		search.addEventListener('focus', () => { searchWrap.style.borderColor = c.accent; searchWrap.style.boxShadow = `0 0 0 1px ${c.accent}`; });
		search.addEventListener('blur', () => { searchWrap.style.borderColor = c.inputBorder; searchWrap.style.boxShadow = 'none'; });
		toolbar.appendChild(searchWrap);
		body.appendChild(toolbar);

		const scroll = doc.createElement('div');
		scroll.style.cssText = 'flex:1;overflow-y:auto;padding:6px 22px 18px;';
		body.appendChild(scroll);

		if (!listLoaded) {
			const loading = doc.createElement('div');
			loading.style.cssText = `padding:36px;text-align:center;color:${c.muted};font-size:12px;display:flex;flex-direction:column;align-items:center;gap:10px;`;
			const spin = doc.createElement('span');
			spin.className = 'codicon codicon-loading codicon-modifier-spin';
			spin.style.fontSize = '20px';
			loading.appendChild(spin);
			const lt = doc.createElement('span');
			lt.textContent = 'Loading records…';
			loading.appendChild(lt);
			scroll.appendChild(loading);
			try {
				listRows = await opts.loadList();
				listLoaded = true;
			} catch {
				listRows = [];
				listLoaded = true;
			}
			scroll.replaceChildren();
		}

		subtitleEl.textContent = `${listRows.length} ${listRows.length === 1 ? 'record' : 'records'}`;

		const renderRows = (filter: string): void => {
			scroll.replaceChildren();
			const lq = filter.trim().toLowerCase();
			const filtered = lq
				? listRows.filter(r => opts.listColumns.some(col => {
					const raw = (r[col.key] ?? '') as unknown;
					const txt = col.format ? col.format(raw, r) : String(raw);
					return txt.toLowerCase().includes(lq);
				}))
				: listRows;

			if (filtered.length === 0) {
				const empty = doc.createElement('div');
				empty.style.cssText = `padding:44px 24px;text-align:center;color:${c.muted};display:flex;flex-direction:column;align-items:center;gap:12px;`;
				const eIco = doc.createElement('span');
				eIco.className = `codicon codicon-${lq ? 'search-stop' : 'inbox'}`;
				eIco.style.cssText = `font-size:26px;opacity:0.5;`;
				empty.appendChild(eIco);
				const eTxt = doc.createElement('div');
				eTxt.textContent = lq ? 'No records match your filter.' : `No ${opts.title.toLowerCase()} yet.`;
				eTxt.style.cssText = 'font-size:12.5px;';
				empty.appendChild(eTxt);
				if (!lq) {
					const eBtn = doc.createElement('button');
					eBtn.type = 'button';
					eBtn.textContent = `Create the first ${singular.toLowerCase()}`;
					eBtn.style.cssText = `margin-top:2px;padding:7px 14px;border:1px solid ${c.border};border-radius:8px;background:transparent;color:${c.fg};font-size:12px;font-weight:600;cursor:pointer;`;
					eBtn.addEventListener('mouseenter', () => { eBtn.style.background = c.hover; });
					eBtn.addEventListener('mouseleave', () => { eBtn.style.background = 'transparent'; });
					eBtn.addEventListener('click', () => renderForm(null));
					empty.appendChild(eBtn);
				}
				scroll.appendChild(empty);
				return;
			}

			const table = doc.createElement('div');
			const cols = opts.listColumns.map(col => col.width || '1fr').join(' ') + ' 76px';
			table.style.cssText = `display:grid;grid-template-columns:${cols};gap:0;margin-top:8px;`;

			for (const col of opts.listColumns) {
				const h = doc.createElement('div');
				h.textContent = col.label;
				h.style.cssText = `font-size:9.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${c.muted};padding:6px 10px 8px 0;border-bottom:1px solid ${c.border};`;
				table.appendChild(h);
			}
			const hAct = doc.createElement('div');
			hAct.style.cssText = `border-bottom:1px solid ${c.border};`;
			table.appendChild(hAct);

			for (const row of filtered) {
				const cells: HTMLElement[] = [];
				const setRowBg = (bg: string): void => { for (const el of cells) { el.style.background = bg; } };
				for (const col of opts.listColumns) {
					const cell = doc.createElement('div');
					const raw = (row[col.key] ?? '') as unknown;
					cell.textContent = col.format ? col.format(raw, row) : String(raw || '—');
					cell.style.cssText = `padding:9px 10px 9px 0;border-bottom:1px solid ${c.border};font-size:12.5px;color:${c.fg};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;transition:background 0.1s;`;
					cell.addEventListener('click', () => { renderForm(row); });
					table.appendChild(cell);
					cells.push(cell);
				}
				const actCell = doc.createElement('div');
				actCell.style.cssText = `padding:5px 0;border-bottom:1px solid ${c.border};display:flex;align-items:center;justify-content:flex-end;gap:2px;transition:background 0.1s;`;
				cells.push(actCell);
				const mkAct = (codicon: string, title: string, onClick: () => void): void => {
					const b = doc.createElement('button') as HTMLButtonElement;
					b.title = title;
					b.setAttribute('aria-label', title);
					b.style.cssText = `width:26px;height:26px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;color:${c.fg};padding:0;`;
					const ico = doc.createElement('span');
					ico.className = `codicon codicon-${codicon}`;
					ico.style.fontSize = '13px';
					b.appendChild(ico);
					b.addEventListener('mouseenter', () => { b.style.background = c.hover; b.style.borderColor = c.border; });
					b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; b.style.borderColor = 'transparent'; });
					b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
					actCell.appendChild(b);
				};
				mkAct('edit', 'Edit', () => renderForm(row));
				if (opts.deleteRecord) {
					mkAct('trash', 'Delete', () => { void handleDelete(row); });
				}
				for (const el of cells) {
					el.addEventListener('mouseenter', () => setRowBg(c.hover));
					el.addEventListener('mouseleave', () => setRowBg('transparent'));
				}
				table.appendChild(actCell);
			}
			scroll.appendChild(table);
		};
		renderRows('');
		search.addEventListener('input', () => renderRows(search.value));
	};

	const handleDelete = async (row: Record<string, unknown>): Promise<void> => {
		if (!opts.deleteRecord) { return; }
		const id = getRowId(row);
		if (!id) { return; }
		try {
			await opts.deleteRecord(id);
			listLoaded = false;
			opts.onChanged?.();
			await renderList();
		} catch (err) {
			const win2 = doc.defaultView;
			win2?.alert?.(err instanceof Error ? err.message : String(err));
		}
	};

	/** Render one field control (input / textarea / themed select / typeahead)
	 *  into `host`, registering it in `inputs` and wiring focus rings. */
	const renderFieldControl = (
		field: IEditFieldDef,
		initial: string,
		inputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
		host: HTMLElement,
	): void => {
		const focusRing = (el: HTMLElement, on: boolean): void => {
			el.style.borderColor = on ? c.accent : c.inputBorder;
			el.style.boxShadow = on ? `0 0 0 1px ${c.accent}` : 'none';
		};
		const baseInput = `width:100%;box-sizing:border-box;padding:8px 10px;font-size:12.5px;font-family:inherit;border:1px solid ${c.inputBorder};border-radius:8px;background:${c.inputBg};color:var(--vscode-input-foreground,${c.fg});outline:none;transition:border-color 0.12s,box-shadow 0.12s;`;

		if (field.kind === 'textarea') {
			const ta = doc.createElement('textarea');
			ta.rows = 3;
			ta.value = initial;
			ta.placeholder = field.placeholder || '';
			ta.setAttribute('autocomplete', 'off');
			ta.style.cssText = baseInput + 'resize:vertical;min-height:64px;line-height:1.45;';
			ta.addEventListener('focus', () => focusRing(ta, true));
			ta.addEventListener('blur', () => focusRing(ta, false));
			host.appendChild(ta);
			inputs.set(field.key, ta);
			return;
		}

		if (field.kind === 'select') {
			// Custom theme-styled dropdown (native <select> option lists render
			// with low-contrast OS chrome on dark themes). A hidden input holds
			// the value so the save flow is unchanged.
			const hidden = doc.createElement('input');
			hidden.type = 'hidden';
			hidden.value = initial;
			host.appendChild(hidden);
			inputs.set(field.key, hidden);

			const trigger = doc.createElement('button');
			trigger.type = 'button';
			trigger.setAttribute('aria-haspopup', 'listbox');
			trigger.style.cssText = baseInput + 'display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer;text-align:left;';
			const tLabel = doc.createElement('span');
			tLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			const tCaret = doc.createElement('span');
			tCaret.className = 'codicon codicon-chevron-down';
			tCaret.style.cssText = `font-size:13px;opacity:0.6;flex-shrink:0;`;
			trigger.appendChild(tLabel);
			trigger.appendChild(tCaret);
			const labelFor = (val: string): string => {
				const m = (field.options || []).find(o => o.value === val);
				return m ? m.label : (val || field.placeholder || 'Select…');
			};
			const refresh = (): void => { tLabel.textContent = labelFor(hidden.value); tLabel.style.opacity = hidden.value ? '1' : '0.55'; };
			refresh();

			const panel = doc.createElement('div');
			panel.setAttribute('role', 'listbox');
			// Mounted on workbenchRoot (outside `.ciyex-editor-root`), so without this
			// class the panel falls back to the browser's default chunky scrollbar — the
			// "vertical scroll bar" QA flagged on the New Payment > Payment Method select.
			// The class applies the app's thin themed scrollbar (ciyexCommon.css).
			panel.className = 'ciyex-select-panel';
			panel.style.cssText = `position:fixed;background:${c.popoverBg};color:${c.fg};border:1px solid ${c.border};border-radius:9px;box-shadow:0 10px 28px ${c.shadow};z-index:10000;max-height:260px;overflow-y:auto;display:none;padding:4px;`;
			workbenchRoot.appendChild(panel);

			const position = (): void => {
				const r = trigger.getBoundingClientRect();
				panel.style.left = `${r.left}px`;
				panel.style.top = `${r.bottom + 4}px`;
				panel.style.minWidth = `${r.width}px`;
			};
			const renderOpts = (): void => {
				DOM.clearNode(panel);
				for (const opt of field.options || []) {
					const r = doc.createElement('div');
					r.setAttribute('role', 'option');
					const sel = opt.value === hidden.value;
					r.textContent = opt.label;
					r.style.cssText = `padding:7px 10px;cursor:pointer;font-size:12.5px;border-radius:6px;background:${sel ? c.hover : 'transparent'};color:${c.fg};${sel ? 'font-weight:600;' : ''}`;
					r.addEventListener('mouseenter', () => { r.style.background = c.hover; });
					r.addEventListener('mouseleave', () => { r.style.background = opt.value === hidden.value ? c.hover : 'transparent'; });
					r.addEventListener('mousedown', (e) => {
						e.preventDefault();
						e.stopPropagation();
						hidden.value = opt.value;
						refresh();
						closePanel();
						// Notify dependents (e.g. showWhen conditional fields) that the
						// value changed — the hidden input never fires a native change.
						hidden.dispatchEvent(new Event('change', { bubbles: true }));
					});
					panel.appendChild(r);
				}
			};
			let open = false;
			const openPanel = (): void => { renderOpts(); position(); panel.style.display = 'block'; trigger.setAttribute('aria-expanded', 'true'); focusRing(trigger, true); open = true; };
			const closePanel = (): void => { panel.style.display = 'none'; trigger.setAttribute('aria-expanded', 'false'); focusRing(trigger, false); open = false; };
			trigger.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (open) { closePanel(); } else { openPanel(); } });
			const onDocMouseDown = (e: MouseEvent): void => {
				if (!open) { return; }
				const t = e.target as Node | null;
				if (t && (panel.contains(t) || trigger.contains(t))) { return; }
				closePanel();
			};
			doc.addEventListener('mousedown', onDocMouseDown, true);
			const reposition = (): void => { if (open) { position(); } };
			doc.defaultView?.addEventListener('scroll', reposition, true);
			doc.defaultView?.addEventListener('resize', reposition);
			popovers.push({ panel, reposition, onDocMouseDown });
			host.appendChild(trigger);
			return;
		}

		if (field.kind === 'time') {
			// Custom HH:MM dropdown instead of <input type="time"> so the picker
			// closes deterministically on selection (native blur is a no-op in the
			// Electron workbench).
			const hiddenTime = createTimeDropdown({ parent: host, initialValue: initial, placeholder: field.placeholder || 'Select time...' });
			inputs.set(field.key, hiddenTime);
			return;
		}

		if (field.kind === 'date') {
			// MM/DD/YYYY masked text + calendar picker (see openRecordEditDialog) —
			// avoids the native date input's 6-digit-year / no-auto-slash behaviour.
			const { hidden: hiddenDate } = createUsDateField(doc, host, initial, baseInput, c.fg);
			inputs.set(field.key, hiddenDate);
			return;
		}

		// text / number / email / tel / search
		const inp = doc.createElement('input') as HTMLInputElement;
		inp.type = field.kind && ['text', 'number', 'email', 'tel'].includes(field.kind) ? field.kind : 'text';
		inp.value = initial;
		inp.placeholder = field.placeholder || '';
		inp.setAttribute('autocomplete', 'off');
		inp.style.cssText = baseInput;
		if (field.readonly) {
			// Derived / auto-calculated field (e.g. BMI) — read-only + dimmed so
			// it reads as non-editable, matching the chart editor.
			inp.setAttribute('readonly', 'readonly');
			inp.style.background = 'rgba(128,128,128,0.06)';
			inp.style.opacity = '0.85';
			inp.style.cursor = 'default';
		}
		inp.addEventListener('focus', () => focusRing(inp, true));
		inp.addEventListener('blur', () => focusRing(inp, false));
		host.appendChild(inp);
		inputs.set(field.key, inp);

		// Typeahead dropdown for search fields wired with onSearch.
		if (field.kind === 'search' && field.onSearch) {
			const onSearch = field.onSearch;
			const onSelect = field.onSelectSearchResult;
			// Lock to a value picked from the results by default — a name typed but
			// never selected from the list can't be saved (opt out: strictSelect:false).
			const strict = field.strictSelect !== false;
			// After a pick the field becomes read-only with a clear to clear and search
			// again, so a selected name can't be edited away from the chosen record.
			let setLocked: ((locked: boolean) => void) | undefined;
			if (strict) {
				const holder = doc.createElement('span');
				holder.style.cssText = 'position:relative;display:block;';
				inp.parentElement?.insertBefore(holder, inp);
				holder.appendChild(inp);
				inp.style.paddingRight = '24px';
				const clearBtn = doc.createElement('span');
				clearBtn.textContent = '\u2715';
				clearBtn.title = 'Clear selection';
				clearBtn.style.cssText = `position:absolute;right:10px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:12px;color:${c.fg};opacity:0.6;display:none;line-height:1;`;
				holder.appendChild(clearBtn);
				setLocked = (locked: boolean): void => {
					inp.readOnly = locked;
					inp.dataset.selected = locked ? '1' : '';
					clearBtn.style.display = locked ? 'block' : 'none';
				};
				clearBtn.addEventListener('mousedown', (e) => {
					e.preventDefault(); e.stopPropagation();
					setLocked!(false);
					inp.value = '';
					inp.focus();
				});
				// An existing record's saved value counts as an already-confirmed pick.
				if (inp.value.trim()) { setLocked(true); }
			}
			const panel = doc.createElement('div');
			panel.style.cssText = `position:fixed;background:${c.popoverBg};color:${c.fg};border:1px solid ${c.border};border-radius:9px;box-shadow:0 10px 28px ${c.shadow};z-index:10000;max-height:240px;overflow-y:auto;display:none;padding:4px;`;
			workbenchRoot.appendChild(panel);
			const position = (): void => {
				const r = inp.getBoundingClientRect();
				panel.style.left = `${r.left}px`;
				panel.style.top = `${r.bottom + 4}px`;
				panel.style.width = `${r.width}px`;
			};
			const reposition = (): void => { if (panel.style.display === 'block') { position(); } };
			doc.defaultView?.addEventListener('scroll', reposition, true);
			doc.defaultView?.addEventListener('resize', reposition);
			popovers.push({ panel, reposition });
			let handle: ReturnType<typeof setTimeout> | undefined;
			const render = (results: Array<{ value: string; label: string; description?: string; details?: Record<string, string> }>): void => {
				DOM.clearNode(panel);
				if (results.length === 0) { panel.style.display = 'none'; return; }
				for (const res of results) {
					const o = doc.createElement('div');
					o.style.cssText = `padding:7px 10px;cursor:pointer;font-size:12px;border-radius:6px;color:${c.fg};`;
					const l = doc.createElement('div'); l.textContent = res.label; l.style.fontWeight = '600'; o.appendChild(l);
					if (res.description) { const d = doc.createElement('div'); d.textContent = res.description; d.style.cssText = `font-size:11px;color:${c.muted};margin-top:1px;`; o.appendChild(d); }
					o.addEventListener('mouseenter', () => { o.style.background = c.hover; });
					o.addEventListener('mouseleave', () => { o.style.background = 'transparent'; });
					o.addEventListener('mousedown', (e) => {
						e.preventDefault();
						e.stopPropagation();
						inp.value = res.label;
						if (setLocked) { setLocked(true); } else { inp.dataset.selected = '1'; }
						if (onSelect) { onSelect(res, inputs); }
						panel.style.display = 'none';
						// Hiding this body-mounted panel during mousedown makes the
						// trailing synthetic click resolve to the dialog's overlay
						// scrim (which closes the form), losing the selection before
						// save. Swallow that one click.
						const swallowNextClick = (ev: Event) => {
							ev.stopPropagation();
							ev.preventDefault();
							doc.removeEventListener('click', swallowNextClick, true);
						};
						doc.addEventListener('click', swallowNextClick, true);
						doc.defaultView?.setTimeout(() => doc.removeEventListener('click', swallowNextClick, true), 100);
					});
					panel.appendChild(o);
				}
				position();
				panel.style.display = 'block';
			};
			inp.addEventListener('input', () => {
				// Typing invalidates a prior selection until a new result is picked.
				if (strict) { inp.dataset.selected = ''; }
				const q = inp.value.trim();
				if (handle) { clearTimeout(handle); }
				if (q.length < 2) { panel.style.display = 'none'; return; }
				handle = setTimeout(async () => {
					try { render((await onSearch(q)).slice(0, 8)); } catch { panel.style.display = 'none'; }
				}, 250);
			});
			inp.addEventListener('blur', () => {
				setTimeout(() => {
					panel.style.display = 'none';
					// Drop text that was never confirmed against the list.
					if (strict && inp.dataset.selected !== '1' && inp.value) { inp.value = ''; }
				}, 150);
			});
		}
	};

	const renderForm = (existing: Record<string, unknown> | null): void => {
		teardownPopovers();
		currentMode = 'form';
		editingItem = existing;
		const isEdit = !!existing;
		titleEl.textContent = `${isEdit ? 'Edit' : 'New'} ${singular}`;
		subtitleEl.textContent = isEdit ? 'Update the details below' : `Add a new ${singular.toLowerCase()} record`;
		addBtn.style.display = 'none';
		body.replaceChildren();

		const formScroll = doc.createElement('div');
		formScroll.className = 'ciyex-list-form-scroll';
		// Hide the scrollbar gutter (content still scrolls) so the New Payment /
		// New Claim form doesn't show a vertical scrollbar (QA issue 9). Mirrors
		// the openRecordEditDialog form-body treatment.
		formScroll.style.cssText = 'flex:1;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:18px;scrollbar-width:none;-ms-overflow-style:none;';
		const formScrollStyle = doc.createElement('style');
		formScrollStyle.textContent = '.ciyex-list-form-scroll::-webkit-scrollbar{display:none;width:0;height:0;}';
		formScroll.appendChild(formScrollStyle);
		body.appendChild(formScroll);

		const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
		// Fields with a `showWhen` rule, paired with their row wrapper, so we can
		// hide/show them as the controlling field changes (e.g. insurance
		// subscriber fields collapse when "Relationship to Patient" is "Self").
		const conditionalFields: Array<{ field: IEditFieldDef; wrap: HTMLElement }> = [];

		// Partition fields into contiguous sections by key-prefix so clinical
		// forms read as a chart note. Fields with no matching section collapse
		// into a single headerless block.
		const groups: Array<{ title: string; icon: string; fields: IEditFieldDef[] }> = [];
		for (const field of opts.fields) {
			const sec = sectionForField(field.key);
			const title = sec?.title ?? '';
			const last = groups[groups.length - 1];
			if (last && last.title === title) { last.fields.push(field); }
			else { groups.push({ title, icon: sec?.icon ?? '', fields: [field] }); }
		}
		const showHeaders = groups.filter(g => g.title).length > 0 && groups.length > 1;

		for (const group of groups) {
			const section = doc.createElement('div');
			section.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

			if (showHeaders && group.title) {
				const sHead = doc.createElement('div');
				sHead.style.cssText = `display:flex;align-items:center;gap:7px;padding-bottom:7px;border-bottom:1px solid ${c.border};`;
				const sIco = doc.createElement('span');
				sIco.className = `codicon codicon-${group.icon || 'circle-small'}`;
				sIco.style.cssText = `font-size:13px;color:${c.accent};`;
				sHead.appendChild(sIco);
				const sLbl = doc.createElement('span');
				sLbl.textContent = group.title;
				sLbl.style.cssText = `font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${c.muted};`;
				sHead.appendChild(sLbl);
				section.appendChild(sHead);
			}

			const grid = doc.createElement('div');
			grid.style.cssText = 'display:grid;grid-template-columns:repeat(12,1fr);column-gap:14px;row-gap:13px;';
			section.appendChild(grid);

			for (const field of group.fields) {
				const widthPct = field.widthPct ?? 100;
				const span = field.kind === 'textarea' ? 12 : Math.max(2, Math.min(12, Math.round((widthPct / 100) * 12)));
				const wrap = doc.createElement('div');
				wrap.style.cssText = `grid-column:span ${span};display:flex;flex-direction:column;gap:5px;min-width:0;`;
				const lbl = doc.createElement('label');
				lbl.style.cssText = `font-size:10.5px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:${c.muted};display:flex;align-items:center;gap:4px;`;
				const lblText = doc.createElement('span');
				// Strip the section prefix from the label (e.g. "HPI: Onset" → "Onset")
				// when it is shown under that section header, to avoid redundancy.
				let labelText = field.label;
				if (showHeaders && group.title) {
					const m = /^[A-Za-z][A-Za-z /&]*?:\s*(.+)$/.exec(field.label);
					if (m) { labelText = m[1]; }
				}
				lblText.textContent = labelText;
				lbl.appendChild(lblText);
				if (field.required) {
					const star = doc.createElement('span');
					star.textContent = '*';
					star.style.cssText = `color:${c.accent};font-weight:800;`;
					lbl.appendChild(star);
				}
				wrap.appendChild(lbl);

				const initial = String((existing?.[field.key] ?? '') as string | number);
				renderFieldControl(field, initial, inputs, wrap);

				if (field.hint) {
					const hint = doc.createElement('div');
					hint.textContent = field.hint;
					hint.style.cssText = `font-size:11px;color:${c.muted};`;
					wrap.appendChild(hint);
				}
				if (field.showWhen) { conditionalFields.push({ field, wrap }); }
				grid.appendChild(wrap);
			}
			formScroll.appendChild(section);
		}

		// Conditional visibility (showWhen): hide/show dependent fields based on
		// a controlling field's value and keep them in sync as it changes. The
		// custom select dispatches a 'change' on its hidden input on selection.
		if (conditionalFields.length > 0) {
			const applyVisibility = (): void => {
				for (const { field, wrap } of conditionalFields) {
					const when = field.showWhen!;
					const ctrl = inputs.get(when.field);
					const ctrlVal = ctrl?.value ?? '';
					let show = true;
					if (when.equals !== undefined) { show = ctrlVal === when.equals; }
					if (when.notEquals !== undefined) { show = ctrlVal !== when.notEquals; }
					wrap.style.display = show ? '' : 'none';
				}
			};
			const wired = new Set<string>();
			for (const { field } of conditionalFields) {
				const ctrlKey = field.showWhen!.field;
				if (wired.has(ctrlKey)) { continue; }
				wired.add(ctrlKey);
				const ctrl = inputs.get(ctrlKey);
				if (ctrl) {
					ctrl.addEventListener('change', applyVisibility);
					ctrl.addEventListener('input', applyVisibility);
				}
			}
			applyVisibility();
		}

		// Derived fields: recompute every `compute` field from the current
		// values whenever any input changes (and once now). Mirrors the chart
		// editor's BMI auto-calc so the snapshot popup shows the same live value.
		const computeFields = opts.fields.filter(f => typeof f.compute === 'function');
		if (computeFields.length > 0) {
			const recomputeDerived = (): void => {
				const current: Record<string, string> = {};
				inputs.forEach((el, k) => { current[k] = el.value; });
				for (const f of computeFields) {
					const target = inputs.get(f.key);
					if (target) { target.value = f.compute!(current); }
				}
			};
			formScroll.addEventListener('input', recomputeDerived);
			recomputeDerived();
		}

		const footer = doc.createElement('div');
		footer.style.cssText = `padding:13px 22px;border-top:1px solid ${c.border};display:flex;align-items:center;gap:8px;flex-shrink:0;background:${c.raised};`;
		const errorMsg = doc.createElement('span');
		errorMsg.style.cssText = 'flex:1;color:#ef4444;font-size:12px;display:flex;align-items:center;gap:5px;';
		footer.appendChild(errorMsg);
		const setError = (msg: string): void => {
			DOM.clearNode(errorMsg);
			if (!msg) { return; }
			const ico = doc.createElement('span');
			ico.className = 'codicon codicon-warning';
			ico.style.fontSize = '13px';
			errorMsg.appendChild(ico);
			const t = doc.createElement('span');
			t.textContent = msg;
			errorMsg.appendChild(t);
		};

		const backBtn = doc.createElement('button');
		backBtn.type = 'button';
		// In the snapshot's focused flows (closeOnSave) there is no list to manage —
		// the form was opened directly from a card's "+" or edit-pencil. Closing the
		// whole dialog returns the user to the snapshot, instead of dropping them into
		// the records list view (which they did not ask for).
		backBtn.textContent = (isEdit || opts.closeOnSave) ? 'Cancel' : 'Back to list';
		backBtn.style.cssText = `padding:8px 16px;border:1px solid ${c.border};border-radius:8px;background:transparent;color:${c.fg};font-size:12px;font-weight:600;cursor:pointer;transition:background 0.12s;`;
		backBtn.addEventListener('mouseenter', () => { backBtn.style.background = c.hover; });
		backBtn.addEventListener('mouseleave', () => { backBtn.style.background = 'transparent'; });
		backBtn.addEventListener('click', () => { if (opts.closeOnSave) { close(); } else { void renderList(); } });
		footer.appendChild(backBtn);

		const saveBtn = doc.createElement('button');
		saveBtn.type = 'button';
		saveBtn.textContent = opts.primaryLabel || (isEdit ? 'Save Changes' : 'Save');
		saveBtn.style.cssText = `padding:8px 18px;border:none;border-radius:8px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);font-size:12px;font-weight:700;cursor:pointer;transition:background 0.12s;`;
		saveBtn.addEventListener('mouseenter', () => { if (!saveBtn.disabled) { saveBtn.style.background = 'var(--vscode-button-hoverBackground,#1177bb)'; } });
		saveBtn.addEventListener('mouseleave', () => { saveBtn.style.background = 'var(--vscode-button-background,#0e639c)'; });
		saveBtn.addEventListener('click', async () => {
			setError('');
			const result: Record<string, string> = {};
			for (const f of opts.fields) {
				const input = inputs.get(f.key);
				const v = input?.value ?? '';
				// strictSelect: a search value typed but not picked from the results
				// (e.g. Save clicked before the blur-clear fires) must not be saved.
				if (f.kind === 'search' && f.strictSelect !== false && v.trim() && input?.dataset.selected !== '1') {
					if (input) { input.value = ''; }
					setError(`Please select ${f.label} from the search results`);
					return;
				}
				if (f.required && !v.trim()) {
					setError(`${f.label} is required`);
					return;
				}
				result[f.key] = v;
			}
			saveBtn.disabled = true;
			saveBtn.style.opacity = '0.65';
			saveBtn.style.cursor = 'default';
			const original = saveBtn.textContent;
			saveBtn.textContent = 'Saving…';
			try {
				const existingId = isEdit && editingItem ? getRowId(editingItem) : undefined;
				await opts.saveRecord(result, existingId);
				listLoaded = false;
				opts.onChanged?.();
				// Focused single-record edits close on save rather than bouncing
				// back to the list view (which users found jarring after editing a
				// single encounter from the snapshot).
				if (opts.closeOnSave) { close(); return; }
				await renderList();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
				saveBtn.disabled = false;
				saveBtn.style.opacity = '1';
				saveBtn.style.cursor = 'pointer';
				saveBtn.textContent = original;
			}
		});
		footer.appendChild(saveBtn);
		body.appendChild(footer);

		const firstField = opts.fields[0];
		if (firstField) { inputs.get(firstField.key)?.focus(); }
	};

	addBtn.addEventListener('click', () => renderForm(null));
	closeBtn.addEventListener('click', () => close());

	doc.addEventListener('keydown', onKey, true);
	overlay.addEventListener('click', onOverlayClick);
	workbenchRoot.appendChild(overlay);

	// initial mode
	if (opts.initialMode === 'create') {
		renderForm(null);
	} else if (opts.initialMode === 'edit' && opts.initialItem) {
		renderForm(opts.initialItem);
	} else {
		void renderList();
	}

	const win = DOM.getWindow(opts.themeAnchor || overlay) || mainWindow;
	win.requestAnimationFrame(() => {
		dialog.style.transform = 'scale(1) translateY(0)';
		dialog.style.opacity = '1';
	});

	void currentMode; // referenced via state captured in closures
}
