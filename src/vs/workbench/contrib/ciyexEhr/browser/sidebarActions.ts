/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';

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
	required?: boolean;
	placeholder?: string;
	hint?: string;
	/** Width hint as a percentage of the row (defaults to 100 for full row). */
	widthPct?: number;
	/** Search-typeahead callback used when {@link kind} is `'search'`. Called
	 *  while the user types — returns a list of matches to show in a dropdown
	 *  beneath the input. */
	onSearch?: (query: string) => Promise<Array<{ value: string; label: string; description?: string; details?: Record<string, string> }>>;
	/** Optional callback fired when the user selects a search match. Lets the
	 *  caller fill related fields (e.g. selecting a patient autofills
	 *  patientId). */
	onSelectSearchResult?: (item: { value: string; label: string; details?: Record<string, string> }, allInputs: Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
}

export interface IEditDialogOptions {
	title: string;
	fields: IEditFieldDef[];
	values: Record<string, unknown>;
	onSave: (next: Record<string, string>) => Promise<void> | void;
	primaryLabel?: string;
	themeAnchor?: HTMLElement;
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
				return { value: name, label: name, description: pid ? `MRN ${pid}` : undefined, details: { patientId: pid, firstName: (p.firstName as string) || '', lastName: (p.lastName as string) || '' } };
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
					const name = (p.name || p.fullName || `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || '') as string;
					const npi = (p.npi as string) || '';
					return { value: name, label: name, description: npi ? `NPI ${npi}` : undefined, details: { npi, firstName: (p.firstName as string) || '', lastName: (p.lastName as string) || '' } };
				});
			}
			return [];
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
				},
			};
		}
		if (['prescribername', 'providername', 'referringprovider', 'physicianname', 'administeredby', 'authorname', 'provider', 'orderingprovider'].includes(k)) {
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
		// CVX vaccine code search.
		if (k === 'cvxcode') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('CVX', q) };
		}
		// CPT procedure code search.
		if (k === 'procedurecode' || k === 'cptcode') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('CPT', q) };
		}
		// ICD-10 diagnosis code search.
		if (k === 'diagnosiscode' || k === 'icd10' || k === 'icdcode') {
			return { ...f, kind: 'search' as const, onSearch: (q) => fetchCodeSystem('ICD10_CM', q) };
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
		// Insurance search.
		if (k === 'insurancename') {
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
							.map(p => ({ value: String(p.name || p.label || ''), label: String(p.name || p.label || ''), description: String(p.payerId || p.id || '') }));
					} catch { return []; }
				},
			};
		}
		return f;
	});
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

	const overlay = doc.createElement('div');
	overlay.className = 'ciyex-edit-dialog-overlay';
	// Keep the overlay transparent — only the inline rgba(0,0,0,0.25)
	// scrim darkens the workbench underneath. Mounting inside
	// `workbenchRoot` (below) gives the drawer its CSS variables; we do
	// NOT also copy the workbench classList onto the overlay because that
	// turned the entire left half into a solid black panel — the second
	// `.monaco-workbench` element painted over the real workbench content.
	overlay.style.cssText = `position:fixed;top:${titlebarHeight}px;left:0;right:0;bottom:0;z-index:2000;display:flex;align-items:stretch;justify-content:flex-end;background:rgba(0,0,0,0.25);`;

	const dialog = doc.createElement('div');
	dialog.style.cssText = [
		'width:520px',
		'max-width:90vw',
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
	].join(';');

	const header = doc.createElement('div');
	header.style.cssText = `padding:18px 22px;border-bottom:1px solid ${colors.separator};font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-shrink:0;`;
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
	form.style.cssText = 'padding:18px 22px;display:grid;grid-template-columns:1fr 1fr;column-gap:16px;row-gap:14px;overflow-y:auto;flex:1;align-content:start;scrollbar-width:none;-ms-overflow-style:none;';
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
		// widthPct >= 75% spans both grid columns - mirrors the EHR-UI drawer
		// layout where Notes / single text fields fill the whole row.
		const widthPct = field.widthPct ?? 100;
		const spanFull = widthPct >= 75 || field.kind === 'textarea';
		wrap.style.cssText = `${spanFull ? 'grid-column:1 / -1;' : ''}display:flex;flex-direction:column;gap:4px;min-width:0;`;

		const lbl = doc.createElement('label');
		lbl.textContent = field.label + (field.required ? ' *' : '');
		lbl.style.cssText = `font-size:12px;font-weight:500;color:${colors.foreground};opacity:0.8;`;
		wrap.appendChild(lbl);

		const initial = String(opts.values[field.key] ?? '');
		let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
		let searchPanel: HTMLDivElement | null = null;
		if (field.kind === 'textarea') {
			const ta = doc.createElement('textarea');
			ta.rows = 3;
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
			panel.style.cssText = `position:fixed;background-color:${popoverBg};color:${colors.foreground};border:1px solid ${popoverBorder};border-radius:4px;box-shadow:0 6px 18px ${popoverShadow};z-index:10000;max-height:260px;overflow-y:auto;display:none;`;
			workbenchRoot.appendChild(panel);

			const positionSelectPanel = () => {
				const rect = trigger.getBoundingClientRect();
				panel.style.left = `${rect.left}px`;
				panel.style.top = `${rect.bottom + 2}px`;
				panel.style.minWidth = `${rect.width}px`;
			};
			const renderSelectOptions = () => {
				panel.innerHTML = '';
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
			if (field.kind !== 'date' && field.kind !== 'time') {
				input.setAttribute('readonly', 'readonly');
				const releaseReadonly = () => { input.removeAttribute('readonly'); };
				input.addEventListener('focus', releaseReadonly, { once: true });
				input.addEventListener('pointerdown', releaseReadonly, { once: true });
			}
		}
		input.style.cssText = `padding:6px 8px;background:${inputBg};color:${colors.foreground};border:1px solid ${inputBorder};border-radius:4px;font-size:13px;font-family:inherit;outline:none;`;
		if (field.placeholder && (DOM.isHTMLInputElement(input) || DOM.isHTMLTextAreaElement(input))) {
			input.placeholder = field.placeholder;
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
				panel.innerHTML = '';
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
				setTimeout(() => { panel.style.display = 'none'; }, 150);
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
			const v = inputs.get(f.key)?.value ?? '';
			if (f.required && !v.trim()) {
				errorMsg.textContent = `${f.label} is required`;
				return;
			}
			result[f.key] = v;
		}
		saveBtn.disabled = true;
		const original = saveBtn.textContent;
		saveBtn.textContent = 'Saving...';
		try {
			await opts.onSave(result);
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
	// drawer just snaps in.
	const win = DOM.getWindow(opts.themeAnchor || overlay) || mainWindow;
	win.requestAnimationFrame(() => {
		dialog.style.transform = 'translateX(0)';
	});

	const first = opts.fields.length > 0 ? inputs.get(opts.fields[0].key) : undefined;
	first?.focus();
}
