/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { FileAccess } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { ColorScheme } from '../../../../platform/theme/common/theme.js';
import { IWorkbenchThemeService, ThemeSettingDefaults } from '../../../services/themes/common/workbenchThemeService.js';
import { ICiyexAuthService, CiyexAuthState } from './ciyexAuthService.js';

/**
 * Calendly link rendered on the email step when a visitor has no Ciyex account
 * yet. Sales/onboarding owns this URL — update here if it changes.
 */
const CIYEX_SCHEDULE_MEETING_URL = 'https://calendly.com/qiaben/ciyex';

type AuthStep = 'email' | 'authenticate' | 'change-password' | 'locked' | 'warning' | 'signup-org' | 'signup-admin' | 'forgot-password';

/**
 * Helper to create a styled element via DOM APIs (no innerHTML, CSP-safe).
 */
function h(tag: string, style?: Partial<CSSStyleDeclaration>, attrs?: Record<string, string>): HTMLElement {
	const el = document.createElement(tag);
	if (style) {
		Object.assign(el.style, style);
	}
	if (attrs) {
		for (const [k, v] of Object.entries(attrs)) {
			el.setAttribute(k, v);
		}
	}
	return el;
}

function text(parent: HTMLElement, str: string): HTMLElement {
	parent.textContent = str;
	return parent;
}

/**
 * Create an SVG element using namespace-aware DOM APIs (CSP/TrustedTypes safe).
 */
function createSvg(size: number, viewBox: string, children: (parent: SVGElement) => void): HTMLElement {
	const NS = 'http://www.w3.org/2000/svg';
	const container = h('div', { display: 'block', margin: '0 auto', width: `${size}px`, height: `${size}px` });
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('width', String(size));
	svg.setAttribute('height', String(size));
	svg.setAttribute('viewBox', viewBox);
	svg.setAttribute('fill', 'none');
	children(svg);
	container.appendChild(svg);
	return container;
}

function svgPath(parent: SVGElement, d: string, attrs: Record<string, string> = {}): void {
	const NS = 'http://www.w3.org/2000/svg';
	const path = document.createElementNS(NS, 'path');
	path.setAttribute('d', d);
	for (const [k, v] of Object.entries(attrs)) {
		path.setAttribute(k, v);
	}
	parent.appendChild(path);
}

function svgRect(parent: SVGElement, attrs: Record<string, string>): void {
	const NS = 'http://www.w3.org/2000/svg';
	const rect = document.createElementNS(NS, 'rect');
	for (const [k, v] of Object.entries(attrs)) {
		rect.setAttribute(k, v);
	}
	parent.appendChild(rect);
}

function svgCircle(parent: SVGElement, attrs: Record<string, string>): void {
	const NS = 'http://www.w3.org/2000/svg';
	const circle = document.createElementNS(NS, 'circle');
	for (const [k, v] of Object.entries(attrs)) {
		circle.setAttribute(k, v);
	}
	parent.appendChild(circle);
}

/**
 * Full-screen auth overlay that blocks the entire workbench until authenticated.
 * Uses DOM APIs exclusively (no innerHTML) to comply with VS Code Trusted Types CSP.
 */
export class CiyexAuthGate extends Disposable {

	private _overlay: HTMLDivElement | undefined;
	private _styleEl: HTMLStyleElement | undefined;
	private _step: AuthStep = 'email';
	private _email = '';
	private _password = '';
	private _newPassword = '';
	private _confirmPassword = '';
	private _showNewPassword = false;
	private _showSettings = false;
	private _showPassword = false;
	private _loading = false;
	private _error = '';
	// Signup form state — held across the two-step flow so going Back
	// preserves what the user typed.
	private _signupOrgName = '';
	private _signupOrgAlias = '';
	private _signupOrgAliasEdited = false;
	private _signupSpecialty = '';
	private _signupFirstName = '';
	private _signupLastName = '';
	private _signupEmail = '';
	private _signupPassword = '';
	private _signupConfirmPassword = '';
	private _showSignupPassword = false;
	private _discoverResult: { exists: boolean; authMethods: string[]; orgName: string; idps: Array<{ alias: string; displayName: string; providerId: string }> } | null = null;
	// Forgot-password flow: email entered on the reset screen + sent-confirmation flag.
	// Kept separate from `_email` so going Back to Welcome-back preserves the original.
	private _forgotEmail = '';
	private _forgotSent = false;
	private _countdown = 120;
	private _countdownInterval: number | null = null;

	constructor(
		private readonly _parent: HTMLElement,
		private readonly _authService: ICiyexAuthService,
		private readonly _openerService: IOpenerService,
		private readonly _themeService: IWorkbenchThemeService,
	) {
		super();

		this._register(this._authService.onDidChangeAuthState(state => this._onAuthStateChanged(state)));
		this._register(this._authService.onSessionWarning(countdown => this._onSessionWarning(countdown)));
		// Re-render whenever the workbench theme changes so the gate (and its
		// theme toggle icon) stays in sync — e.g. the user flipping the toggle
		// or an external theme change.
		this._register(this._themeService.onDidColorThemeChange(() => {
			if (this._overlay && this._overlay.style.display !== 'none') {
				this._render();
			}
		}));

		// Show overlay based on initial auth state
		if (this._authService.state === CiyexAuthState.Locked) {
			// Password-only: email is saved from previous session
			this._step = 'locked';
			this._email = this._authService.userEmail || '';
			this._show();
		} else if (this._authService.state !== CiyexAuthState.Authenticated) {
			this._show();
		}
	}

	/**
	 * Open the given http(s) URL in the user's default external browser.
	 * Used for the "Register", "Terms", and "Privacy" links on the login
	 * card — these intentionally leave the desktop app rather than render
	 * marketing content inline.
	 */
	private _openExternal(url: string): void {
		try {
			void this._openerService.open(URI.parse(url), { openExternal: true });
		} catch {
			// Best-effort: silently ignore a malformed URL rather than crash the gate.
		}
	}

	private _onAuthStateChanged(state: CiyexAuthState): void {
		switch (state) {
			case CiyexAuthState.Authenticated:
				this._hide();
				break;
			case CiyexAuthState.NotAuthenticated:
				this._step = 'email';
				this._email = '';
				this._password = '';
				this._error = '';
				this._discoverResult = null;
				this._show();
				break;
			case CiyexAuthState.Locked:
				this._step = 'locked';
				this._password = '';
				this._error = '';
				this._email = this._authService.userEmail || '';
				this._show();
				break;
			case CiyexAuthState.Warning:
				break;
		}
	}

	private _onSessionWarning(countdown: number): void {
		this._step = 'warning';
		this._countdown = countdown;
		this._show();
		this._startCountdown();
	}

	private _startCountdown(): void {
		this._clearCountdown();
		this._countdownInterval = mainWindow.setInterval(() => {
			this._countdown--;
			if (this._countdown <= 0) {
				this._clearCountdown();
				this._authService.signOut();
			} else {
				this._render();
			}
		}, 1000);
	}

	private _clearCountdown(): void {
		if (this._countdownInterval) {
			mainWindow.clearInterval(this._countdownInterval);
			this._countdownInterval = null;
		}
	}

	private _show(): void {
		if (!this._overlay) {
			this._overlay = document.createElement('div');
			this._overlay.id = 'ciyex-auth-gate';
			this._parent.appendChild(this._overlay);
		}
		this._overlay.style.display = '';
		this._render();
	}

	private _hide(): void {
		this._clearCountdown();
		if (this._overlay) {
			this._overlay.style.display = 'none';
		}
	}

	// --- theme helpers ---
	private _isDark(): boolean {
		// Source of truth is the workbench theme service — toggling it from the
		// login page propagates to the entire app after sign-in.
		const type = this._themeService.getColorTheme().type;
		return type === ColorScheme.DARK || type === ColorScheme.HIGH_CONTRAST_DARK;
	}

	/**
	 * Flip the workbench colour theme between the default light and dark
	 * variants. Writing to ConfigurationTarget.USER persists the choice so it
	 * survives sign-out and is shared across all workbench windows for the
	 * signed-in user.
	 */
	private async _toggleTheme(): Promise<void> {
		const targetSettingsId = this._isDark()
			? ThemeSettingDefaults.COLOR_THEME_LIGHT
			: ThemeSettingDefaults.COLOR_THEME_DARK;
		try {
			const themes = await this._themeService.getColorThemes();
			const next = themes.find(t => t.settingsId === targetSettingsId);
			if (next) {
				await this._themeService.setColorTheme(next.id, ConfigurationTarget.USER);
			}
		} catch {
			// Theme registry not ready or write failed — leave UI as-is; the
			// onDidColorThemeChange subscription will still pick up any change
			// that does land.
		}
	}

	private _colors() {
		const dark = this._isDark();
		return {
			bg: dark ? '#1e1e1e' : '#f0f2f5',
			cardBg: dark ? '#252526' : '#ffffff',
			textPrimary: dark ? '#cccccc' : '#1a1a2e',
			textSecondary: dark ? '#858585' : '#6b7280',
			border: dark ? '#3c3c3c' : '#e5e7eb',
			inputBg: dark ? '#3c3c3c' : '#f9fafb',
			brand: '#0e639c',
			errorBg: dark ? 'rgba(239,68,68,0.15)' : '#fef2f2',
			errorText: dark ? '#f48771' : '#dc2626',
			errorBorder: dark ? '#5a1d1d' : '#fecaca',
			warning: '#f59e0b',
		};
	}

	// --- main render (DOM-based, no innerHTML) ---
	private _render(): void {
		if (!this._overlay) {
			return;
		}
		const c = this._colors();

		// Apply overlay styles directly
		Object.assign(this._overlay.style, {
			position: 'fixed',
			inset: '0',
			zIndex: '99999',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			background: c.bg,
			// eslint-disable-next-line local/code-no-unexternalized-strings
			fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
		});

		// Clear previous children
		while (this._overlay.firstChild) {
			this._overlay.removeChild(this._overlay.firstChild);
		}

		// Add global style element for pseudo-classes (only once)
		if (!this._styleEl) {
			this._styleEl = document.createElement('style');
			this._styleEl.textContent = `
				#ciyex-auth-gate input:focus { border-color: #465FFF !important; box-shadow: 0 0 0 3px rgba(70,95,255,0.15) !important; }
				#ciyex-auth-gate button { cursor: pointer; }
				#ciyex-auth-gate button:disabled { opacity: 0.5; cursor: not-allowed; }
				@keyframes ciyex-spin { to { transform: rotate(360deg); } }
			`;
			mainWindow.document.head.appendChild(this._styleEl);
		}

		let content: HTMLElement;
		if (this._step === 'warning') {
			content = this._buildWarning(c);
		} else if (this._step === 'locked') {
			content = this._buildLocked(c);
		} else if (this._step === 'authenticate') {
			content = this._buildAuthenticate(c);
		} else if (this._step === 'change-password') {
			content = this._buildChangePassword(c);
		} else if (this._step === 'forgot-password') {
			content = this._buildForgotPassword(c);
		} else if (this._step === 'signup-org') {
			content = this._buildSignupOrgStep(c);
		} else if (this._step === 'signup-admin') {
			content = this._buildSignupAdminStep(c);
		} else {
			content = this._buildEmailStep(c);
		}

		this._overlay.appendChild(content);
	}

	// --- Ciyex no-text logo (3D knot PNG with SVG fallback) ---
	private _logo(size: number): HTMLElement {
		const container = h('div', {
			display: 'flex', alignItems: 'center', justifyContent: 'center',
			margin: '0 auto', width: `${size}px`, height: `${size}px`,
		});
		const img = document.createElement('img');
		// FileAccess maps `vs/../../resources/...` to the correct file URL in both
		// dev and packaged builds (where the relative-path form misresolves and
		// shows a broken-image icon).
		img.src = FileAccess.asBrowserUri('vs/workbench/browser/media/ciyex-logo.png').toString(true);
		img.alt = 'Ciyex';
		Object.assign(img.style, { width: `${size}px`, height: `${size}px`, objectFit: 'contain' });
		// Fallback: when the PNG fails to load (custom build, missing resource, CSP),
		// render an SVG mark so the login screen is never branding-less.
		img.addEventListener('error', () => {
			img.remove();
			const fb = this._logoFallback(size);
			container.appendChild(fb);
		});
		container.appendChild(img);
		return container;
	}

	// SVG fallback for the login logo — keeps branding visible when the PNG
	// asset is unavailable for any reason.
	private _logoFallback(size: number): HTMLElement {
		return createSvg(size, '0 0 64 64', (svg) => {
			svg.setAttribute('fill', 'none');
			// Rounded square background
			svgRect(svg, { x: '4', y: '4', width: '56', height: '56', rx: '12', fill: '#465FFF' });
			// "C" stylized mark
			svgPath(svg, 'M44 22a16 16 0 1 0 0 20', {
				stroke: '#ffffff', 'stroke-width': '5', 'stroke-linecap': 'round', fill: 'none',
			});
			svgCircle(svg, { cx: '44', cy: '32', r: '3.5', fill: '#ffffff' });
		});
	}

	// --- Build helpers ---
	private _buildCard(c: ReturnType<typeof this._colors>): HTMLElement {
		return h('div', { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: '12px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' });
	}

	/**
	 * Top-right pill button that flips between light and dark workbench themes.
	 * Sun icon = currently dark (click → light); moon icon = currently light.
	 */
	private _buildThemeToggle(): HTMLElement {
		const dark = this._isDark();
		const btn = document.createElement('button');
		btn.id = 'ciyex-theme-toggle';
		btn.type = 'button';
		btn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
		btn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
		Object.assign(btn.style, {
			position: 'absolute', top: '16px', right: '20px',
			width: '36px', height: '36px',
			display: 'flex', alignItems: 'center', justifyContent: 'center',
			background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
			border: dark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(0,0,0,0.08)',
			borderRadius: '50%',
			color: dark ? '#F9FAFB' : '#374151',
			cursor: 'pointer', padding: '0',
		});
		btn.appendChild(this._themeIcon(dark));
		btn.addEventListener('click', () => { void this._toggleTheme(); });
		return btn;
	}

	private _themeIcon(dark: boolean): HTMLElement {
		// Sun while in dark mode (so the icon previews "what clicking will give you")
		// is a common pattern, but more recognisable here to show the *current*
		// state: sun = light, moon = dark.
		return createSvg(18, '0 0 24 24', (svg) => {
			svg.setAttribute('stroke', 'currentColor');
			svg.setAttribute('stroke-width', '2');
			svg.setAttribute('stroke-linecap', 'round');
			svg.setAttribute('stroke-linejoin', 'round');
			if (dark) {
				// Moon
				svgPath(svg, 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z');
			} else {
				// Sun
				svgCircle(svg, { cx: '12', cy: '12', r: '4' });
				svgPath(svg, 'M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M4.93 19.07l1.41-1.41 M17.66 6.34l1.41-1.41');
			}
		});
	}


	// --- Feature icons for the brand panel ---
	private _featureIcon(type: 'shield' | 'database' | 'doc' | 'cloud'): HTMLElement {
		const wrap = h('div', { flexShrink: '0', width: '20px', height: '20px', opacity: '0.92' });
		const NS = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(NS, 'svg');
		svg.setAttribute('width', '20');
		svg.setAttribute('height', '20');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('fill', 'none');
		svg.setAttribute('stroke', 'currentColor');
		svg.setAttribute('stroke-width', '2');
		svg.setAttribute('stroke-linecap', 'round');
		svg.setAttribute('stroke-linejoin', 'round');
		if (type === 'shield') {
			const p = document.createElementNS(NS, 'path');
			p.setAttribute('d', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z');
			svg.appendChild(p);
		} else if (type === 'database') {
			const e = document.createElementNS(NS, 'ellipse');
			e.setAttribute('cx', '12'); e.setAttribute('cy', '5'); e.setAttribute('rx', '9'); e.setAttribute('ry', '3');
			svg.appendChild(e);
			const p1 = document.createElementNS(NS, 'path'); p1.setAttribute('d', 'M21 12c0 1.66-4 3-9 3s-9-1.34-9-3'); svg.appendChild(p1);
			const p2 = document.createElementNS(NS, 'path'); p2.setAttribute('d', 'M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5'); svg.appendChild(p2);
		} else if (type === 'doc') {
			const p1 = document.createElementNS(NS, 'path'); p1.setAttribute('d', 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'); svg.appendChild(p1);
			const p2 = document.createElementNS(NS, 'polyline'); p2.setAttribute('points', '14 2 14 8 20 8'); svg.appendChild(p2);
			const p3 = document.createElementNS(NS, 'line'); p3.setAttribute('x1', '16'); p3.setAttribute('y1', '13'); p3.setAttribute('x2', '8'); p3.setAttribute('y2', '13'); svg.appendChild(p3);
			const p4 = document.createElementNS(NS, 'line'); p4.setAttribute('x1', '16'); p4.setAttribute('y1', '17'); p4.setAttribute('x2', '8'); p4.setAttribute('y2', '17'); svg.appendChild(p4);
		} else {
			const p = document.createElementNS(NS, 'polyline');
			p.setAttribute('points', '22 12 18 12 15 21 9 3 6 12 2 12');
			svg.appendChild(p);
		}
		wrap.appendChild(svg);
		return wrap;
	}

	// --- Step builders ---
	private _buildEmailStep(_c: ReturnType<typeof this._colors>): HTMLElement {
		const dark = this._isDark();
		const rightBg = dark ? '#1e1e1e' : '#F4F5F7';
		const cardBg = dark ? '#252526' : '#ffffff';
		const cardShadow = dark ? '0 4px 32px rgba(0,0,0,0.4)' : '0 4px 32px rgba(0,0,0,0.08)';
		const titleColor = dark ? '#F9FAFB' : '#111827';
		const subColor = dark ? '#9CA3AF' : '#6B7280';
		const labelColor = dark ? '#D1D5DB' : '#374151';
		const inputBorder = dark ? '1.5px solid #3c3c3c' : '1.5px solid #D1D5DB';
		const inputBg = dark ? '#3c3c3c' : '#fff';
		const inputColor = dark ? '#cccccc' : '#111827';
		const legalColor = dark ? '#6B7280' : '#9CA3AF';

		// Full-screen two-panel layout matching app-dev.ciyex.org/signin
		const wrapper = h('div', { position: 'absolute', inset: '0', display: 'flex' });

		// \u2500\u2500 Left brand panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
		const left = h('div', {
			flex: '0 0 50%', display: 'flex', flexDirection: 'column',
			alignItems: 'center', justifyContent: 'center',
			padding: '48px 56px', color: '#fff',
			background: '#000000',
		});

		left.appendChild(this._logo(80));
		left.appendChild(text(h('h2', { fontSize: '32px', fontWeight: '700', letterSpacing: '-0.5px', margin: '20px 0 8px', color: '#fff' }), 'Ciyex EHR'));
		left.appendChild(text(h('p', { fontSize: '15px', opacity: '0.82', marginBottom: '44px', textAlign: 'center', color: '#fff' }), 'Open Source Public Health Infrastructure'));

		const featureList = h('div', { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '380px' });
		const features: Array<{ icon: 'shield' | 'database' | 'doc' | 'cloud'; label: string }> = [
			{ icon: 'shield', label: 'HIPAA-compliant with enterprise-grade security' },
			{ icon: 'database', label: 'FHIR R4 interoperable health data exchange' },
			{ icon: 'doc', label: 'Patient charting, scheduling & e-prescribing' },
			{ icon: 'cloud', label: 'Cloud-native with self-hosting option' },
		];
		for (const f of features) {
			const item = h('div', {
				display: 'flex', alignItems: 'center', gap: '14px',
				background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.18)',
				borderRadius: '10px', padding: '13px 18px', fontSize: '14px', fontWeight: '500', color: '#fff',
			});
			item.appendChild(this._featureIcon(f.icon));
			const span = document.createElement('span');
			span.textContent = f.label;
			item.appendChild(span);
			featureList.appendChild(item);
		}
		left.appendChild(featureList);
		wrapper.appendChild(left);

		// \u2500\u2500 Right sign-in panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
		const right = h('div', {
			flex: '1', background: rightBg, display: 'flex',
			alignItems: 'center', justifyContent: 'center',
			padding: '48px 32px', position: 'relative',
		});

		const card = h('div', {
			background: cardBg, borderRadius: '16px', boxShadow: cardShadow,
			padding: '48px 44px 40px', width: '100%', maxWidth: '400px',
		});

		card.appendChild(text(h('h1', { fontSize: '24px', fontWeight: '700', color: titleColor, textAlign: 'center', marginBottom: '6px' }), 'Sign In'));
		card.appendChild(text(h('p', { fontSize: '14px', color: subColor, textAlign: 'center', marginBottom: '24px' }), 'Enter your email to continue'));

		// Channel picker — only shown when product.json declares channels.
		// Selecting a channel re-routes API/Keycloak endpoints and tells the
		// auto-updater which release manifest to watch.
		const channels = this._authService.availableChannels;
		const channelKeys = Object.keys(channels) as Array<keyof typeof channels>;
		if (channelKeys.length > 0) {
			const channelWrap = h('div', { marginBottom: '14px' });
			channelWrap.appendChild(text(
				h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: labelColor, marginBottom: '8px' }),
				'Environment'
			));
			const channelSelect = document.createElement('select');
			channelSelect.id = 'ciyex-channel';
			Object.assign(channelSelect.style, {
				width: '100%', padding: '11px 14px', border: inputBorder,
				borderRadius: '8px', fontSize: '14px', color: inputColor,
				outline: 'none', boxSizing: 'border-box', background: inputBg,
				appearance: 'auto', cursor: this._loading ? 'not-allowed' : 'pointer',
			});
			if (this._loading) { channelSelect.disabled = true; }
			const currentChannel = this._authService.selectedChannel;
			for (const key of channelKeys) {
				const opt = document.createElement('option');
				opt.value = String(key);
				opt.textContent = channels[key].label || String(key);
				if (key === currentChannel) { opt.selected = true; }
				channelSelect.appendChild(opt);
			}
			channelSelect.addEventListener('change', async () => {
				const next = channelSelect.value as 'dev' | 'stage' | 'prod';
				if (next === this._authService.selectedChannel) { return; }
				channelSelect.disabled = true;
				try {
					await this._authService.setChannel(next);
				} finally {
					this._error = '';
					this._render();
				}
			});
			channelWrap.appendChild(channelSelect);
			card.appendChild(channelWrap);
		}

		// Email field
		const labelDiv = h('div', {});
		labelDiv.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: labelColor, marginBottom: '8px' }), 'Email'));
		const emailInput = document.createElement('input');
		emailInput.id = 'ciyex-email';
		emailInput.type = 'email';
		emailInput.placeholder = 'you@example.com';
		emailInput.value = this._email;
		emailInput.autocomplete = 'email';
		if (this._loading) { emailInput.disabled = true; }
		Object.assign(emailInput.style, {
			width: '100%', padding: '11px 14px', border: inputBorder,
			borderRadius: '8px', fontSize: '14px', color: inputColor,
			outline: 'none', boxSizing: 'border-box', background: inputBg,
		});
		labelDiv.appendChild(emailInput);
		card.appendChild(labelDiv);

		// Error
		if (this._error) {
			const c = this._colors();
			const err = h('div', {
				background: c.errorBg, border: `1px solid ${c.errorBorder}`, borderRadius: '8px',
				padding: '10px 14px', marginTop: '12px', fontSize: '13px', color: c.errorText,
			});
			err.textContent = this._error;
			card.appendChild(err);
		}

		// Continue button
		const btn = document.createElement('button');
		btn.id = 'ciyex-discover-btn';
		btn.textContent = this._loading ? 'Checking...' : 'Continue';
		btn.disabled = this._loading || !this._email.trim();
		Object.assign(btn.style, {
			display: 'block', width: '100%', marginTop: '20px', padding: '13px',
			background: '#4F6AF0', color: '#fff', fontSize: '15px', fontWeight: '600',
			border: 'none', borderRadius: '8px', cursor: 'pointer',
		});
		card.appendChild(btn);

		// "Don't have an account? Click here" — routes prospects to the
		// Calendly link so the Ciyex team can book a demo before self-signup.
		const scheduleRow = h('p', {
			marginTop: '22px', marginBottom: '0', textAlign: 'center',
			fontSize: '14px', color: subColor, fontWeight: '400',
		});
		scheduleRow.appendChild(document.createTextNode(`Don't have an account? `));
		const scheduleLink = document.createElement('a');
		scheduleLink.id = 'ciyex-schedule-link';
		scheduleLink.href = '#';
		scheduleLink.textContent = 'Click here';
		Object.assign(scheduleLink.style, {
			color: '#4F6AF0', fontWeight: '500', textDecoration: 'none',
		});
		scheduleRow.appendChild(scheduleLink);
		card.appendChild(scheduleRow);

		// Register link
		const registerLink = document.createElement('a');
		registerLink.href = '#';
		registerLink.textContent = 'Register a new practice';
		Object.assign(registerLink.style, {
			display: 'block', textAlign: 'center', marginTop: '10px',
			fontSize: '14px', color: '#4F6AF0', fontWeight: '500', textDecoration: 'none',
		});
		card.appendChild(registerLink);

		// Legal
		const legal = h('p', { marginTop: '14px', textAlign: 'center', fontSize: '12px', color: legalColor });
		legal.appendChild(document.createTextNode('By signing in, you agree to our '));
		const termsA = document.createElement('a'); termsA.href = '#'; termsA.textContent = 'Terms';
		Object.assign(termsA.style, { color: '#4F6AF0', textDecoration: 'none' });
		legal.appendChild(termsA);
		legal.appendChild(document.createTextNode(' & '));
		const privacyA = document.createElement('a'); privacyA.href = '#'; privacyA.textContent = 'Privacy Policy';
		Object.assign(privacyA.style, { color: '#4F6AF0', textDecoration: 'none' });
		legal.appendChild(privacyA);
		legal.appendChild(document.createTextNode('.'));
		card.appendChild(legal);

		right.appendChild(card);

		// Theme toggle (top-right corner) — flips the workbench colour theme
		// so the choice persists through sign-in and into the rest of the app.
		const themeToggle = this._buildThemeToggle();
		right.appendChild(themeToggle);

		// Server Settings link (bottom-right corner)
		const settingsLink = document.createElement('button');
		settingsLink.id = 'ciyex-settings-toggle';
		settingsLink.textContent = 'Server Settings';
		Object.assign(settingsLink.style, {
			position: 'absolute', bottom: '16px', right: '20px',
			background: 'none', border: 'none', color: '#9CA3AF',
			fontSize: '11px', padding: '4px 8px', cursor: 'pointer', textDecoration: 'underline',
		});
		right.appendChild(settingsLink);

		wrapper.appendChild(right);

		// Settings popup overlay (modal on top of login)
		if (this._showSettings) {
			const backdrop = h('div', {
				position: 'fixed', inset: '0', zIndex: '100000',
				display: 'flex', alignItems: 'center', justifyContent: 'center',
				background: 'rgba(0,0,0,0.5)',
			});
			const popup = h('div', {
				background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px',
				padding: '24px', width: '380px', maxWidth: '90vw',
				boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
			});
			const headerRow = h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' });
			headerRow.appendChild(text(h('h3', { fontSize: '15px', fontWeight: '600', color: '#111827', margin: '0' }), 'Server Settings'));
			const closeBtn = document.createElement('button');
			closeBtn.textContent = '\u2715';
			Object.assign(closeBtn.style, { background: 'none', border: 'none', color: '#6B7280', fontSize: '16px', cursor: 'pointer', padding: '0 4px' });
			headerRow.appendChild(closeBtn);
			popup.appendChild(headerRow);
			const fields: Array<{ label: string; key: string; value: string; placeholder: string }> = [
				{ label: 'API Server', key: 'ciyex_api_url', value: this._authService.apiUrl, placeholder: 'https://api-dev.ciyex.org' },
				{ label: 'Keycloak URL', key: 'ciyex_keycloak_url', value: this._authService.keycloakUrl, placeholder: 'https://dev.aran.me' },
				{ label: 'Keycloak Realm', key: 'ciyex_keycloak_realm', value: this._authService.keycloakRealm, placeholder: 'ciyex' },
				{ label: 'Keycloak Client ID', key: 'ciyex_keycloak_client_id', value: this._authService.keycloakClientId, placeholder: 'ciyex-app' },
			];
			const inputs: HTMLInputElement[] = [];
			for (const f of fields) {
				const row = h('div', { marginBottom: '12px' });
				row.appendChild(text(h('label', { display: 'block', fontSize: '12px', fontWeight: '500', color: '#6B7280', marginBottom: '4px' }), f.label));
				const inp = document.createElement('input');
				inp.id = `ciyex-cfg-${f.key}`; inp.type = 'text';
				inp.placeholder = f.placeholder; inp.value = f.value;
				Object.assign(inp.style, {
					width: '100%', padding: '8px 10px', borderRadius: '8px',
					border: '1px solid #D1D5DB', background: '#f9fafb',
					color: '#111827', fontSize: '13px', boxSizing: 'border-box', outline: 'none',
				});
				row.appendChild(inp);
				popup.appendChild(row);
				inputs.push(inp);
			}
			const saveBtn = document.createElement('button');
			saveBtn.textContent = 'Save';
			Object.assign(saveBtn.style, {
				width: '100%', padding: '10px', marginTop: '4px', background: '#4F6AF0',
				color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
			});
			popup.appendChild(saveBtn);
			backdrop.appendChild(popup);
			this._overlay!.appendChild(backdrop);
			const closePopup = () => { this._showSettings = false; this._render(); };
			closeBtn.addEventListener('click', closePopup);
			backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { closePopup(); } });
			saveBtn.addEventListener('click', () => {
				for (let i = 0; i < fields.length; i++) {
					const val = inputs[i].value.trim();
					if (val) { localStorage.setItem(fields[i].key, fields[i].key === 'ciyex_api_url' ? val.replace(/\/$/, '') : val); }
				}
				closePopup();
			});
		}

		// Listeners
		emailInput.addEventListener('input', () => { this._email = emailInput.value; btn.disabled = !this._email.trim(); });
		emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this._handleDiscover(); } });
		btn.addEventListener('click', () => this._handleDiscover());
		settingsLink.addEventListener('click', () => { this._showSettings = true; this._render(); });
		registerLink.addEventListener('click', (e) => {
			e.preventDefault();
			// Render the in-app signup flow rather than punting to the
			// marketing site — matches ciyex-ehr-ui /signup behaviour.
			this._step = 'signup-org';
			this._error = '';
			this._render();
		});
		scheduleLink.addEventListener('click', (e) => {
			e.preventDefault();
			this._openExternal(CIYEX_SCHEDULE_MEETING_URL);
		});
		termsA.addEventListener('click', (e) => {
			e.preventDefault();
			this._openExternal('https://ciyex.org/terms');
		});
		privacyA.addEventListener('click', (e) => {
			e.preventDefault();
			this._openExternal('https://ciyex.org/privacy');
		});
		setTimeout(() => emailInput.focus(), 50);

		return wrapper;
	}

	// --- Shared two-panel skeleton (left brand + right card) ---
	private _buildTwoPanel(title: string, subtitle: string): { wrapper: HTMLElement; card: HTMLElement } {
		const dark = this._isDark();
		const rightBg = dark ? '#1e1e1e' : '#F4F5F7';
		const cardBg = dark ? '#252526' : '#ffffff';
		const cardShadow = dark ? '0 4px 32px rgba(0,0,0,0.4)' : '0 4px 32px rgba(0,0,0,0.08)';
		const titleColor = dark ? '#F9FAFB' : '#111827';
		const subColor = dark ? '#9CA3AF' : '#6B7280';

		const wrapper = h('div', { position: 'absolute', inset: '0', display: 'flex' });

		// -- Left brand panel --
		const left = h('div', {
			flex: '0 0 50%', display: 'flex', flexDirection: 'column',
			alignItems: 'center', justifyContent: 'center',
			padding: '48px 56px', color: '#fff',
			background: '#000000',
		});
		left.appendChild(this._logo(80));
		left.appendChild(text(h('h2', { fontSize: '32px', fontWeight: '700', letterSpacing: '-0.5px', margin: '20px 0 8px', color: '#fff' }), 'Ciyex EHR'));
		left.appendChild(text(h('p', { fontSize: '15px', opacity: '0.82', marginBottom: '44px', textAlign: 'center', color: '#fff' }), 'Open Source Public Health Infrastructure'));
		const featureList = h('div', { display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '380px' });
		const features: Array<{ icon: 'shield' | 'database' | 'doc' | 'cloud'; label: string }> = [
			{ icon: 'shield', label: 'HIPAA-compliant with enterprise-grade security' },
			{ icon: 'database', label: 'FHIR R4 interoperable health data exchange' },
			{ icon: 'doc', label: 'Patient charting, scheduling & e-prescribing' },
			{ icon: 'cloud', label: 'Cloud-native with self-hosting option' },
		];
		for (const f of features) {
			const item = h('div', {
				display: 'flex', alignItems: 'center', gap: '14px',
				background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.18)',
				borderRadius: '10px', padding: '13px 18px', fontSize: '14px', fontWeight: '500', color: '#fff',
			});
			item.appendChild(this._featureIcon(f.icon));
			const span = document.createElement('span'); span.textContent = f.label;
			item.appendChild(span);
			featureList.appendChild(item);
		}
		left.appendChild(featureList);
		wrapper.appendChild(left);

		// -- Right panel --
		const right = h('div', {
			flex: '1', background: rightBg, display: 'flex',
			alignItems: 'center', justifyContent: 'center',
			padding: '48px 32px', position: 'relative',
		});
		const card = h('div', {
			background: cardBg, borderRadius: '16px',
			boxShadow: cardShadow,
			padding: '48px 44px 40px', width: '100%', maxWidth: '400px',
		});
		card.appendChild(text(h('h1', { fontSize: '24px', fontWeight: '700', color: titleColor, textAlign: 'center', marginBottom: '6px' }), title));
		card.appendChild(text(h('p', { fontSize: '14px', color: subColor, textAlign: 'center', marginBottom: '28px' }), subtitle));
		right.appendChild(card);
		// Keep the theme toggle reachable from every auth step (welcome back,
		// signup, forgot password, …), not just the email entry screen.
		right.appendChild(this._buildThemeToggle());
		wrapper.appendChild(right);
		return { wrapper, card };
	}

	private _lightInput(id: string, type: string, placeholder: string, value: string): HTMLInputElement {
		const dark = this._isDark();
		const input = document.createElement('input');
		input.id = id; input.type = type; input.placeholder = placeholder; input.value = value;
		if (this._loading) { input.disabled = true; }
		Object.assign(input.style, {
			width: '100%', padding: '11px 14px',
			border: dark ? '1.5px solid #3c3c3c' : '1.5px solid #D1D5DB',
			borderRadius: '8px', fontSize: '14px',
			color: dark ? '#cccccc' : '#111827',
			outline: 'none', boxSizing: 'border-box',
			background: dark ? '#3c3c3c' : '#fff',
		});
		return input;
	}

	private _lightButton(id: string, label: string, primary: boolean, disabled?: boolean): HTMLButtonElement {
		const dark = this._isDark();
		const btn = document.createElement('button');
		btn.id = id; btn.disabled = !!disabled; btn.textContent = label;
		Object.assign(btn.style, {
			display: 'block', width: '100%', padding: '13px', marginTop: '16px',
			background: primary ? '#4F6AF0' : 'none',
			color: primary ? '#fff' : (dark ? '#858585' : '#6B7280'),
			border: primary ? 'none' : `1px solid ${dark ? '#3c3c3c' : '#D1D5DB'}`,
			fontSize: '15px', fontWeight: '600', borderRadius: '8px', cursor: 'pointer',
		});
		return btn;
	}

	private _lightError(): HTMLElement | null {
		const dark = this._isDark();
		if (!this._error) { return null; }
		const div = h('div', {
			background: dark ? 'rgba(239,68,68,0.15)' : '#fef2f2',
			border: `1px solid ${dark ? '#5a1d1d' : '#fecaca'}`,
			borderRadius: '8px', padding: '10px 14px', marginTop: '12px',
			fontSize: '13px', color: dark ? '#f48771' : '#dc2626',
		});
		div.textContent = this._error;
		return div;
	}

	private _buildAuthenticate(_c: ReturnType<typeof this._colors>): HTMLElement {
		const dark = this._isDark();
		const { wrapper, card } = this._buildTwoPanel(
			'Welcome back',
			this._discoverResult?.orgName ? `${this._email} · ${this._discoverResult.orgName}` : this._email
		);

		// Back button
		const backBtn = document.createElement('button');
		backBtn.id = 'ciyex-back-btn';
		backBtn.textContent = '← Back';
		Object.assign(backBtn.style, { background: 'none', border: 'none', color: dark ? '#858585' : '#6B7280', fontSize: '13px', padding: '0 0 16px', cursor: 'pointer', display: 'block' });
		card.appendChild(backBtn);

		// Password field
		const pwLabel = h('div', {});
		pwLabel.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: dark ? '#D1D5DB' : '#374151', marginBottom: '8px' }), 'Password'));
		const pwWrap = h('div', { position: 'relative' });
		const pwInput = this._lightInput('ciyex-password', this._showPassword ? 'text' : 'password', 'Enter your password', this._password);
		pwInput.style.paddingRight = '40px';
		pwInput.autocomplete = 'current-password';
		const toggleBtn = document.createElement('button');
		toggleBtn.id = 'ciyex-toggle-pw';
		// allow-any-unicode-next-line
		toggleBtn.textContent = this._showPassword ? '◉' : '◎';
		Object.assign(toggleBtn.style, { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9CA3AF', padding: '2px', fontSize: '16px', cursor: 'pointer' });
		pwWrap.appendChild(pwInput);
		pwWrap.appendChild(toggleBtn);
		pwLabel.appendChild(pwWrap);
		card.appendChild(pwLabel);

		// Forgot password link, right-aligned under the password field.
		const forgotRow = h('div', { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' });
		const forgotLink = document.createElement('a');
		forgotLink.id = 'ciyex-forgot-link';
		forgotLink.href = '#';
		forgotLink.textContent = 'Forgot password?';
		Object.assign(forgotLink.style, { fontSize: '13px', color: '#4F6AF0', textDecoration: 'none', fontWeight: '500' });
		forgotRow.appendChild(forgotLink);
		card.appendChild(forgotRow);

		const err = this._lightError();
		if (err) { card.appendChild(err); }

		const loginBtn = this._lightButton('ciyex-login-btn', this._loading ? 'Signing in...' : 'Sign In', true, this._loading || !this._password);
		card.appendChild(loginBtn);

		// IDP buttons
		const idpButtons: HTMLButtonElement[] = [];
		if (this._discoverResult?.idps?.length) {
			const divider = h('div', { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #E5E7EB', textAlign: 'center' });
			divider.appendChild(text(h('span', { fontSize: '11px', color: '#9CA3AF' }), 'or sign in with'));
			card.appendChild(divider);
			const idpRow = h('div', { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' });
			for (const idp of this._discoverResult.idps) {
				const idpBtn = this._lightButton(`ciyex-idp-${idp.alias}`, `Continue with ${idp.displayName || idp.alias}`, false);
				idpBtn.style.fontSize = '13px';
				idpRow.appendChild(idpBtn);
				idpButtons.push(idpBtn);
			}
			card.appendChild(idpRow);
		}

		// Listeners
		backBtn.addEventListener('click', () => { this._step = 'email'; this._password = ''; this._error = ''; this._discoverResult = null; this._render(); });
		pwInput.addEventListener('input', () => { this._password = pwInput.value; loginBtn.disabled = !this._password; });
		pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this._handleLogin(); } });
		toggleBtn.addEventListener('click', () => { this._showPassword = !this._showPassword; this._render(); });
		loginBtn.addEventListener('click', () => this._handleLogin());
		forgotLink.addEventListener('click', (e) => {
			e.preventDefault();
			this._forgotEmail = this._email;
			this._forgotSent = false;
			this._error = '';
			this._step = 'forgot-password';
			this._render();
		});
		if (this._discoverResult?.idps) {
			for (let i = 0; i < idpButtons.length; i++) {
				const alias = this._discoverResult.idps[i].alias;
				idpButtons[i].addEventListener('click', () => this._handleIdpLogin(alias));
			}
		}
		setTimeout(() => pwInput.focus(), 50);
		return wrapper;
	}

	private _buildChangePassword(_c: ReturnType<typeof this._colors>): HTMLElement {
		const { wrapper, card } = this._buildTwoPanel(
			'Set New Password',
			'Your temporary password was accepted. Please create a new password.'
		);

		// Back button
		const backBtn = document.createElement('button');
		backBtn.id = 'ciyex-back-btn';
		backBtn.textContent = '← Back';
		Object.assign(backBtn.style, { background: 'none', border: 'none', color: '#6B7280', fontSize: '13px', padding: '0 0 16px', cursor: 'pointer', display: 'block' });
		card.appendChild(backBtn);

		// New password
		const newDiv = h('div', { marginBottom: '16px' });
		newDiv.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }), 'New Password'));
		const newWrap = h('div', { position: 'relative' });
		const newInput = this._lightInput('ciyex-new-password', this._showNewPassword ? 'text' : 'password', 'Enter new password', this._newPassword);
		newInput.style.paddingRight = '40px'; newInput.autocomplete = 'new-password'; newInput.minLength = 8;
		const toggleBtn = document.createElement('button');
		toggleBtn.id = 'ciyex-toggle-new-pw';
		// allow-any-unicode-next-line
		toggleBtn.textContent = this._showNewPassword ? '◉' : '◎';
		Object.assign(toggleBtn.style, { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9CA3AF', padding: '2px', fontSize: '16px', cursor: 'pointer' });
		newWrap.appendChild(newInput); newWrap.appendChild(toggleBtn);
		newDiv.appendChild(newWrap);
		card.appendChild(newDiv);

		// Confirm password
		const confirmDiv = h('div', {});
		confirmDiv.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }), 'Confirm Password'));
		const confirmInput = this._lightInput('ciyex-confirm-password', this._showNewPassword ? 'text' : 'password', 'Confirm new password', this._confirmPassword);
		confirmInput.autocomplete = 'new-password'; confirmInput.minLength = 8;
		confirmDiv.appendChild(confirmInput);
		card.appendChild(confirmDiv);

		const err = this._lightError();
		if (err) { card.appendChild(err); }

		const submitBtn = this._lightButton('ciyex-set-pw-btn', this._loading ? 'Setting password…' : 'Set Password & Sign In', true, this._loading || !this._newPassword || !this._confirmPassword);
		card.appendChild(submitBtn);

		// Listeners
		backBtn.addEventListener('click', () => { this._step = 'authenticate'; this._newPassword = ''; this._confirmPassword = ''; this._error = ''; this._render(); });
		newInput.addEventListener('input', () => { this._newPassword = newInput.value; submitBtn.disabled = !this._newPassword || !this._confirmPassword; });
		confirmInput.addEventListener('input', () => { this._confirmPassword = confirmInput.value; submitBtn.disabled = !this._newPassword || !this._confirmPassword; });
		const onEnter = (e: KeyboardEvent): void => { if (e.key === 'Enter') { void this._handleChangePassword(); } };
		newInput.addEventListener('keydown', onEnter);
		confirmInput.addEventListener('keydown', onEnter);
		toggleBtn.addEventListener('click', () => { this._showNewPassword = !this._showNewPassword; this._render(); });
		submitBtn.addEventListener('click', () => { void this._handleChangePassword(); });
		setTimeout(() => newInput.focus(), 50);
		return wrapper;
	}

	private _buildForgotPassword(_c: ReturnType<typeof this._colors>): HTMLElement {
		const dark = this._isDark();
		const title = this._forgotSent ? 'Check your email' : 'Reset your password';
		const subtitle = this._forgotSent
			? `If an account exists for ${this._forgotEmail || 'that email'}, we've sent a password reset link.`
			: 'Enter your email and we\'ll send you a link to reset your password.';
		const { wrapper, card } = this._buildTwoPanel(title, subtitle);

		// Back button → Authenticate when we came from there, otherwise email step.
		const backBtn = document.createElement('button');
		backBtn.id = 'ciyex-forgot-back-btn';
		backBtn.textContent = '← Back to sign in';
		Object.assign(backBtn.style, { background: 'none', border: 'none', color: dark ? '#858585' : '#6B7280', fontSize: '13px', padding: '0 0 16px', cursor: 'pointer', display: 'block' });
		card.appendChild(backBtn);

		if (this._forgotSent) {
			// Success state: just show a "Return to sign in" button.
			const doneBtn = this._lightButton('ciyex-forgot-done-btn', 'Return to sign in', true);
			card.appendChild(doneBtn);
			doneBtn.addEventListener('click', () => {
				this._forgotSent = false;
				this._forgotEmail = '';
				this._error = '';
				this._step = this._discoverResult ? 'authenticate' : 'email';
				this._render();
			});
			backBtn.addEventListener('click', () => {
				this._forgotSent = false;
				this._forgotEmail = '';
				this._error = '';
				this._step = this._discoverResult ? 'authenticate' : 'email';
				this._render();
			});
			return wrapper;
		}

		// Email field (pre-filled from current login attempt when available)
		const emailLabel = h('div', {});
		emailLabel.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: dark ? '#D1D5DB' : '#374151', marginBottom: '8px' }), 'Email'));
		const emailInput = this._lightInput('ciyex-forgot-email', 'email', 'you@example.com', this._forgotEmail);
		emailInput.autocomplete = 'email';
		emailLabel.appendChild(emailInput);
		card.appendChild(emailLabel);

		const err = this._lightError();
		if (err) { card.appendChild(err); }

		const sendBtn = this._lightButton('ciyex-forgot-send-btn', this._loading ? 'Sending...' : 'Send reset link', true, this._loading || !this._forgotEmail.trim());
		card.appendChild(sendBtn);

		// Listeners
		emailInput.addEventListener('input', () => { this._forgotEmail = emailInput.value; sendBtn.disabled = !this._forgotEmail.trim(); });
		emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { void this._handleForgotPassword(); } });
		sendBtn.addEventListener('click', () => { void this._handleForgotPassword(); });
		backBtn.addEventListener('click', () => {
			this._error = '';
			this._step = this._discoverResult ? 'authenticate' : 'email';
			this._render();
		});

		setTimeout(() => emailInput.focus(), 50);
		return wrapper;
	}

	private _buildLocked(_c: ReturnType<typeof this._colors>): HTMLElement {
		const subtitle = this._email
			? `Session locked · ${this._email}`
			: 'Your session has expired. Sign in again.';
		const { wrapper, card } = this._buildTwoPanel('Session Locked', subtitle);

		// Password field
		const pwLabel = h('div', {});
		pwLabel.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '8px' }), 'Password'));
		const pwInput = this._lightInput('ciyex-password', this._showPassword ? 'text' : 'password', 'Enter your password', this._password);
		pwInput.autocomplete = 'current-password';
		pwLabel.appendChild(pwInput);
		card.appendChild(pwLabel);

		const err = this._lightError();
		if (err) { card.appendChild(err); }

		const unlockBtn = this._lightButton('ciyex-login-btn', this._loading ? 'Signing in...' : 'Unlock', true, this._loading || !this._password);
		card.appendChild(unlockBtn);

		const switchBtn = this._lightButton('ciyex-switch-account-btn', 'Sign in with a different account', false);
		switchBtn.style.marginTop = '8px';
		card.appendChild(switchBtn);

		// Forgot password link
		const forgotRow = h('div', { display: 'flex', justifyContent: 'center', marginTop: '12px' });
		const forgotLink = document.createElement('a');
		forgotLink.id = 'ciyex-forgot-link-locked';
		forgotLink.href = '#';
		forgotLink.textContent = 'Forgot password?';
		Object.assign(forgotLink.style, { fontSize: '13px', color: '#4F6AF0', textDecoration: 'none', fontWeight: '500' });
		forgotRow.appendChild(forgotLink);
		card.appendChild(forgotRow);

		// Listeners
		pwInput.addEventListener('input', () => { this._password = pwInput.value; unlockBtn.disabled = !this._password; });
		pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this._handleLogin(); } });
		unlockBtn.addEventListener('click', () => this._handleLogin());
		switchBtn.addEventListener('click', () => this._authService.signOut());
		forgotLink.addEventListener('click', (e) => {
			e.preventDefault();
			this._forgotEmail = this._email;
			this._forgotSent = false;
			this._error = '';
			this._step = 'forgot-password';
			this._render();
		});
		setTimeout(() => pwInput.focus(), 50);
		return wrapper;
	}

	private _buildWarning(c: ReturnType<typeof this._colors>): HTMLElement {
		const wrapper = h('div', { width: '100%', maxWidth: '400px', padding: '16px' });
		const card = this._buildCard(c);
		card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';

		// Header row
		const headerRow = h('div', { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' });
		const iconCircle = h('div', { width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' });
		iconCircle.appendChild(createSvg(20, '0 0 24 24', (svg) => {
			svg.setAttribute('stroke', c.warning);
			svg.setAttribute('stroke-width', '2');
			svgPath(svg, 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', fill: 'none' });
		}));
		headerRow.appendChild(iconCircle);
		headerRow.appendChild(text(h('h3', { fontSize: '18px', fontWeight: '600', color: c.textPrimary, margin: '0' }), 'Session Expiring'));
		card.appendChild(headerRow);

		// Countdown text
		const mins = Math.floor(this._countdown / 60);
		const secs = this._countdown % 60;
		const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
		const countdownP = h('p', { fontSize: '14px', color: c.textSecondary, margin: '0 0 4px' });
		countdownP.appendChild(document.createTextNode('Your session will expire in '));
		const timeSpan = h('span', { fontWeight: '700', color: c.warning });
		timeSpan.textContent = timeStr;
		countdownP.appendChild(timeSpan);
		card.appendChild(countdownP);

		card.appendChild(text(h('p', { fontSize: '13px', color: c.textSecondary, margin: '0 0 20px' }), 'Click below to stay logged in, or you will be signed out automatically.'));

		// Buttons
		const btnRow = h('div', { display: 'flex', gap: '10px' });
		const stayBtn = this._lightButton('ciyex-stay-btn', 'Stay Logged In', true);
		stayBtn.style.flex = '1'; stayBtn.style.marginTop = '0';
		const signOutBtn = this._lightButton('ciyex-signout-btn', 'Sign Out', false);
		signOutBtn.style.flex = '1'; signOutBtn.style.marginTop = '0';
		btnRow.appendChild(stayBtn);
		btnRow.appendChild(signOutBtn);
		card.appendChild(btnRow);
		wrapper.appendChild(card);

		// Listeners
		stayBtn.addEventListener('click', () => { this._clearCountdown(); this._authService.dismissWarning(); });
		signOutBtn.addEventListener('click', () => { this._clearCountdown(); this._authService.signOut(); });

		return wrapper;
	}

	// --- Signup step builders ---

	/** Slugify a practice name into a URL-safe org alias (matches the backend normalizer). */
	private _slugify(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '')
			.replace(/\s+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
	}

	/** Visual step indicator (two pills) for the two-step signup flow. */
	private _signupStepIndicator(step: 1 | 2): HTMLElement {
		const dark = this._isDark();
		const inactive = dark ? '#3c3c3c' : '#E5E7EB';
		const wrap = h('div', { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' });
		const pill1 = h('div', { flex: '1', height: '4px', borderRadius: '999px', background: step >= 1 ? '#4F6AF0' : inactive });
		const pill2 = h('div', { flex: '1', height: '4px', borderRadius: '999px', background: step >= 2 ? '#4F6AF0' : inactive });
		wrap.appendChild(pill1);
		wrap.appendChild(pill2);
		return wrap;
	}

	/** Standard labelled input used inside the signup cards. */
	private _labelledInput(
		labelText: string,
		required: boolean,
		input: HTMLInputElement,
		hint?: string,
	): HTMLElement {
		const dark = this._isDark();
		const wrap = h('div', {});
		const label = h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: dark ? '#D1D5DB' : '#374151', marginBottom: '6px' });
		label.appendChild(document.createTextNode(labelText));
		if (required) {
			const star = document.createElement('span');
			star.textContent = ' *';
			star.style.color = '#EF4444';
			label.appendChild(star);
		}
		wrap.appendChild(label);
		wrap.appendChild(input);
		if (hint) {
			const p = h('p', { fontSize: '12px', color: dark ? '#6B7280' : '#9CA3AF', marginTop: '4px' });
			p.textContent = hint;
			wrap.appendChild(p);
		}
		return wrap;
	}

	private _buildSignupOrgStep(_c: ReturnType<typeof this._colors>): HTMLElement {
		const dark = this._isDark();
		const { wrapper, card } = this._buildTwoPanel('Create your practice', 'Step 1 of 2 — Practice information');

		// Reset & re-insert step indicator above the title so its spacing
		// matches the ehr-ui /signup layout. _buildTwoPanel already appended
		// the title/subtitle, so we prepend the indicator at the top.
		card.insertBefore(this._signupStepIndicator(1), card.firstChild);

		const form = h('div', { display: 'flex', flexDirection: 'column', gap: '14px' });

		// Practice name
		const orgNameInput = this._lightInput('ciyex-signup-org-name', 'text', 'e.g., Sunrise Family Medicine', this._signupOrgName);
		orgNameInput.autocomplete = 'organization';
		form.appendChild(this._labelledInput('Practice Name', true, orgNameInput));

		// Organization ID
		const orgAliasInput = this._lightInput('ciyex-signup-org-alias', 'text', 'sunrise-family-medicine', this._signupOrgAlias);
		orgAliasInput.autocomplete = 'off';
		form.appendChild(this._labelledInput('Organization ID', true, orgAliasInput, 'This will be your unique identifier'));

		// Specialty (optional)
		const specialtyInput = this._lightInput('ciyex-signup-specialty', 'text', 'e.g., Family Medicine, Cardiology', this._signupSpecialty);
		specialtyInput.autocomplete = 'off';
		form.appendChild(this._labelledInput('Specialty', false, specialtyInput));

		const err = this._lightError();
		if (err) { form.appendChild(err); }

		const continueBtn = this._lightButton('ciyex-signup-continue', 'Continue', true, !this._signupOrgName.trim() || !this._signupOrgAlias.trim());
		form.appendChild(continueBtn);

		card.appendChild(form);

		// "Already have an account? Sign in" footer
		const footer = h('p', { marginTop: '18px', textAlign: 'center', fontSize: '13px', color: dark ? '#9CA3AF' : '#6B7280' });
		footer.appendChild(document.createTextNode('Already have an account? '));
		const signInLink = document.createElement('a');
		signInLink.href = '#';
		signInLink.textContent = 'Sign in';
		Object.assign(signInLink.style, { color: '#4F6AF0', textDecoration: 'none', fontWeight: '500' });
		footer.appendChild(signInLink);
		card.appendChild(footer);

		// Listeners
		orgNameInput.addEventListener('input', () => {
			this._signupOrgName = orgNameInput.value;
			// Auto-derive the alias from the practice name until the user
			// edits the alias field manually (matches SignUpForm.tsx UX).
			if (!this._signupOrgAliasEdited) {
				this._signupOrgAlias = this._slugify(orgNameInput.value);
				orgAliasInput.value = this._signupOrgAlias;
			}
			continueBtn.disabled = !this._signupOrgName.trim() || !this._signupOrgAlias.trim();
		});
		orgAliasInput.addEventListener('input', () => {
			this._signupOrgAliasEdited = true;
			this._signupOrgAlias = orgAliasInput.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
			if (orgAliasInput.value !== this._signupOrgAlias) {
				orgAliasInput.value = this._signupOrgAlias;
			}
			continueBtn.disabled = !this._signupOrgName.trim() || !this._signupOrgAlias.trim();
		});
		specialtyInput.addEventListener('input', () => { this._signupSpecialty = specialtyInput.value; });
		const goNext = (): void => {
			if (!this._signupOrgName.trim() || !this._signupOrgAlias.trim()) { return; }
			this._error = '';
			this._step = 'signup-admin';
			this._render();
		};
		continueBtn.addEventListener('click', goNext);
		const onEnter = (e: KeyboardEvent): void => { if (e.key === 'Enter') { goNext(); } };
		orgNameInput.addEventListener('keydown', onEnter);
		orgAliasInput.addEventListener('keydown', onEnter);
		specialtyInput.addEventListener('keydown', onEnter);
		signInLink.addEventListener('click', (e) => {
			e.preventDefault();
			this._step = 'email';
			this._error = '';
			this._render();
		});

		setTimeout(() => orgNameInput.focus(), 50);
		return wrapper;
	}

	private _buildSignupAdminStep(_c: ReturnType<typeof this._colors>): HTMLElement {
		const dark = this._isDark();
		const { wrapper, card } = this._buildTwoPanel('Admin account', '');

		// _buildTwoPanel appends [h1, subtitle p] to card; replace the
		// placeholder subtitle with the org-name-aware variant. Accessing
		// childNodes by index keeps us off querySelector (banned by hygiene).
		const subtitleEl = card.childNodes[1] as HTMLElement | undefined;
		if (subtitleEl) {
			subtitleEl.textContent = '';
			subtitleEl.appendChild(document.createTextNode('Step 2 of 2 — Your admin credentials for '));
			const strong = h('span', { fontWeight: '600', color: dark ? '#E5E7EB' : '#374151' });
			strong.textContent = this._signupOrgName || 'your practice';
			subtitleEl.appendChild(strong);
		}

		card.insertBefore(this._signupStepIndicator(2), card.firstChild);

		// Back button just above the form
		const backBtn = document.createElement('button');
		backBtn.id = 'ciyex-signup-back-btn';
		backBtn.textContent = '← Back';
		Object.assign(backBtn.style, { background: 'none', border: 'none', color: dark ? '#9CA3AF' : '#6B7280', fontSize: '13px', padding: '0 0 12px', cursor: 'pointer', display: 'block' });
		card.appendChild(backBtn);

		const form = h('div', { display: 'flex', flexDirection: 'column', gap: '14px' });

		// First / Last name row
		const nameRow = h('div', { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' });
		const firstInput = this._lightInput('ciyex-signup-first-name', 'text', 'John', this._signupFirstName);
		firstInput.autocomplete = 'given-name';
		const lastInput = this._lightInput('ciyex-signup-last-name', 'text', 'Doe', this._signupLastName);
		lastInput.autocomplete = 'family-name';
		nameRow.appendChild(this._labelledInput('First Name', true, firstInput));
		nameRow.appendChild(this._labelledInput('Last Name', true, lastInput));
		form.appendChild(nameRow);

		// Email
		const emailInput = this._lightInput('ciyex-signup-email', 'email', 'john@example.com', this._signupEmail);
		emailInput.autocomplete = 'email';
		form.appendChild(this._labelledInput('Email', true, emailInput));

		// Password (with show/hide toggle)
		const pwWrap = h('div', { position: 'relative' });
		const pwInput = this._lightInput('ciyex-signup-password', this._showSignupPassword ? 'text' : 'password', 'At least 8 characters', this._signupPassword);
		pwInput.autocomplete = 'new-password';
		pwInput.minLength = 8;
		pwInput.style.paddingRight = '40px';
		const toggleBtn = document.createElement('button');
		toggleBtn.id = 'ciyex-signup-toggle-pw';
		toggleBtn.type = 'button';
		// allow-any-unicode-next-line
		toggleBtn.textContent = this._showSignupPassword ? '◉' : '◎';
		Object.assign(toggleBtn.style, { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9CA3AF', padding: '2px', fontSize: '16px', cursor: 'pointer' });
		pwWrap.appendChild(pwInput);
		pwWrap.appendChild(toggleBtn);
		const pwField = h('div', {});
		const pwLabel = h('label', { display: 'block', fontSize: '13px', fontWeight: '600', color: dark ? '#D1D5DB' : '#374151', marginBottom: '6px' });
		pwLabel.appendChild(document.createTextNode('Password'));
		const pwStar = document.createElement('span'); pwStar.textContent = ' *'; pwStar.style.color = '#EF4444';
		pwLabel.appendChild(pwStar);
		pwField.appendChild(pwLabel);
		pwField.appendChild(pwWrap);
		form.appendChild(pwField);

		// Confirm password
		const confirmInput = this._lightInput('ciyex-signup-confirm', this._showSignupPassword ? 'text' : 'password', 'Confirm your password', this._signupConfirmPassword);
		confirmInput.autocomplete = 'new-password';
		confirmInput.minLength = 8;
		form.appendChild(this._labelledInput('Confirm Password', true, confirmInput));

		const err = this._lightError();
		if (err) { form.appendChild(err); }

		const submitBtn = this._lightButton(
			'ciyex-signup-submit',
			this._loading ? 'Creating your practice…' : 'Create Account',
			true,
			this._loading || !this._signupFirstName.trim() || !this._signupLastName.trim() || !this._signupEmail.trim() || !this._signupPassword || !this._signupConfirmPassword,
		);
		form.appendChild(submitBtn);
		card.appendChild(form);

		// Footer link
		const footer = h('p', { marginTop: '18px', textAlign: 'center', fontSize: '13px', color: dark ? '#9CA3AF' : '#6B7280' });
		footer.appendChild(document.createTextNode('Already have an account? '));
		const signInLink = document.createElement('a');
		signInLink.href = '#';
		signInLink.textContent = 'Sign in';
		Object.assign(signInLink.style, { color: '#4F6AF0', textDecoration: 'none', fontWeight: '500' });
		footer.appendChild(signInLink);
		card.appendChild(footer);

		// Listeners
		const refreshDisabled = (): void => {
			submitBtn.disabled = this._loading || !this._signupFirstName.trim() || !this._signupLastName.trim() || !this._signupEmail.trim() || !this._signupPassword || !this._signupConfirmPassword;
		};
		firstInput.addEventListener('input', () => { this._signupFirstName = firstInput.value; refreshDisabled(); });
		lastInput.addEventListener('input', () => { this._signupLastName = lastInput.value; refreshDisabled(); });
		emailInput.addEventListener('input', () => { this._signupEmail = emailInput.value; refreshDisabled(); });
		pwInput.addEventListener('input', () => { this._signupPassword = pwInput.value; refreshDisabled(); });
		confirmInput.addEventListener('input', () => { this._signupConfirmPassword = confirmInput.value; refreshDisabled(); });
		toggleBtn.addEventListener('click', () => { this._showSignupPassword = !this._showSignupPassword; this._render(); });
		const onEnter = (e: KeyboardEvent): void => { if (e.key === 'Enter') { void this._handleSignup(); } };
		firstInput.addEventListener('keydown', onEnter);
		lastInput.addEventListener('keydown', onEnter);
		emailInput.addEventListener('keydown', onEnter);
		pwInput.addEventListener('keydown', onEnter);
		confirmInput.addEventListener('keydown', onEnter);
		submitBtn.addEventListener('click', () => { void this._handleSignup(); });
		backBtn.addEventListener('click', () => { this._step = 'signup-org'; this._error = ''; this._render(); });
		signInLink.addEventListener('click', (e) => {
			e.preventDefault();
			this._step = 'email';
			this._error = '';
			this._render();
		});

		setTimeout(() => firstInput.focus(), 50);
		return wrapper;
	}

	// --- API handlers ---
	private async _handleDiscover(): Promise<void> {
		if (!this._email.trim() || this._loading) {
			return;
		}
		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.discover(this._email);
		this._loading = false;

		if (result.error) {
			this._error = result.error;
			this._render();
			return;
		}
		if (!result.exists) {
			this._error = 'No account found with this email. Contact your administrator.';
			this._render();
			return;
		}

		this._discoverResult = result;
		this._step = 'authenticate';
		this._render();
	}

	private async _handleLogin(): Promise<void> {
		if (!this._email.trim() || !this._password || this._loading) {
			return;
		}
		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.login(this._email, this._password);
		this._loading = false;

		if (result.success) {
			// Auth service flips state to Authenticated which hides the gate.
			return;
		}
		if (result.requiresPasswordChange) {
			// Temporary password accepted — Keycloak requires the user to set
			// a permanent one before issuing a session token. Switch to the
			// change-password step (matches ciyex-ehr-ui SignInForm).
			this._step = 'change-password';
			this._newPassword = '';
			this._confirmPassword = '';
			this._error = '';
			this._render();
			return;
		}
		this._error = result.error || 'Login failed';
		this._render();
	}

	private async _handleChangePassword(): Promise<void> {
		if (this._loading) {
			return;
		}
		if (!this._newPassword || !this._confirmPassword) {
			this._error = 'Please fill in both password fields.';
			this._render();
			return;
		}
		if (this._newPassword !== this._confirmPassword) {
			this._error = 'Passwords do not match.';
			this._render();
			return;
		}
		if (this._newPassword.length < 8) {
			this._error = 'Password must be at least 8 characters.';
			this._render();
			return;
		}
		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.changePassword(this._email, this._password, this._newPassword);
		this._loading = false;

		if (result.success) {
			this._password = '';
			this._newPassword = '';
			this._confirmPassword = '';
			// Auth service moves to Authenticated on success.
			return;
		}
		this._error = result.error || 'Failed to set new password.';
		this._render();
	}

	private async _handleSignup(): Promise<void> {
		if (this._loading) {
			return;
		}
		if (!this._signupFirstName.trim() || !this._signupLastName.trim() || !this._signupEmail.trim() || !this._signupPassword) {
			this._error = 'Please fill in all required fields.';
			this._render();
			return;
		}
		if (this._signupPassword !== this._signupConfirmPassword) {
			this._error = 'Passwords do not match.';
			this._render();
			return;
		}
		if (this._signupPassword.length < 8) {
			this._error = 'Password must be at least 8 characters.';
			this._render();
			return;
		}

		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.signup({
			orgName: this._signupOrgName,
			orgAlias: this._signupOrgAlias,
			firstName: this._signupFirstName,
			lastName: this._signupLastName,
			email: this._signupEmail,
			password: this._signupPassword,
			specialty: this._signupSpecialty,
		});
		this._loading = false;

		if (result.success) {
			// Auth service flips state to Authenticated which hides the gate.
			// Wipe the in-memory form fields so they don't leak into a future
			// signout-and-resignup flow on the same machine.
			this._signupOrgName = '';
			this._signupOrgAlias = '';
			this._signupOrgAliasEdited = false;
			this._signupSpecialty = '';
			this._signupFirstName = '';
			this._signupLastName = '';
			this._signupEmail = '';
			this._signupPassword = '';
			this._signupConfirmPassword = '';
			return;
		}
		this._error = result.error || 'Signup failed';
		this._render();
	}

	private async _handleForgotPassword(): Promise<void> {
		if (this._loading) {
			return;
		}
		const email = this._forgotEmail.trim();
		if (!email) {
			this._error = 'Please enter your email.';
			this._render();
			return;
		}
		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.forgotPassword(email);
		this._loading = false;

		if (result.success) {
			this._forgotSent = true;
			this._render();
			return;
		}
		this._error = result.error || 'Unable to send reset email.';
		this._render();
	}

	private async _handleIdpLogin(idpAlias: string): Promise<void> {
		if (this._loading) {
			return;
		}
		this._loading = true;
		this._error = '';
		this._render();

		const result = await this._authService.keycloakLogin(this._email, idpAlias);
		this._loading = false;

		if (!result.success) {
			this._error = result.error || 'SSO login failed';
			this._render();
		}
	}

	override dispose(): void {
		this._clearCountdown();
		if (this._overlay) {
			this._overlay.remove();
			this._overlay = undefined;
		}
		if (this._styleEl) {
			this._styleEl.remove();
			this._styleEl = undefined;
		}
		super.dispose();
	}
}
