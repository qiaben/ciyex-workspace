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

/** Shared icon button style — neutral, theme-aware. */
const ACTION_BTN_BASE = 'padding:2px 6px;border:none;border-radius:3px;cursor:pointer;font-size:11px;line-height:1;background:transparent;color:var(--vscode-foreground);opacity:0.75;transition:background 0.1s,opacity 0.1s;';

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
	btn.textContent = symbol;
	btn.title = label;
	btn.setAttribute('aria-label', label);
	btn.style.cssText = ACTION_BTN_BASE;
	btn.addEventListener('mouseenter', () => {
		btn.style.background = 'var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08))';
		btn.style.opacity = '1';
	});
	btn.addEventListener('mouseleave', () => {
		btn.style.background = 'transparent';
		btn.style.opacity = '0.75';
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
			'gap:10px',
			'width:100%',
			'padding:6px 12px',
			'border:none',
			'background:transparent',
			'color:inherit',
			'font:inherit',
			'text-align:left',
			'cursor:' + (item.disabled ? 'default' : 'pointer'),
			'opacity:' + (item.disabled ? '0.45' : '1'),
		].join(';');

		const iconEl = ownerDoc.createElement('span');
		// Force monochrome text presentation so the icon picks up the menu's
		// foreground colour (theme-aware) instead of the OS emoji palette.
		// `font-variant-emoji: text` covers modern Chromium; the U+FE0E
		// variation selector below covers codepoints that ignore the property
		// (e.g. iOS / older glyph fonts).
		iconEl.textContent = toMonochromeGlyph(item.symbol || '');
		iconEl.style.cssText = 'flex-shrink:0;width:22px;text-align:center;font-size:16px;line-height:1;color:inherit;font-variant-emoji:text;';
		row.appendChild(iconEl);

		const labelEl = ownerDoc.createElement('span');
		labelEl.textContent = item.label || '';
		labelEl.style.cssText = 'flex:1;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
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
	// allow-any-unicode-next-line
	const btn = createActionIconButton(parent, '⋯', label, () => {
		const resolved = typeof items === 'function' ? items() : items;
		const usable = resolved.filter(i => i.separator || (i.label && i.onClick));
		if (usable.length === 0) { return; }
		openOverflowMenu(btn, resolved);
	});
	return btn;
}
