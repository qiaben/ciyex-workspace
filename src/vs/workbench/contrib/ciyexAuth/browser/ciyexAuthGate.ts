/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICiyexAuthService, CiyexAuthState } from './ciyexAuthService.js';

type AuthStep = 'email' | 'authenticate' | 'locked' | 'warning';

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
	private _showSettings = false;
	private _showPassword = false;
	private _loading = false;
	private _error = '';
	private _discoverResult: { exists: boolean; authMethods: string[]; orgName: string; idps: Array<{ alias: string; displayName: string; providerId: string }> } | null = null;
	private _countdown = 120;
	private _countdownInterval: ReturnType<typeof setInterval> | null = null;

	constructor(
		private readonly _parent: HTMLElement,
		private readonly _authService: ICiyexAuthService
	) {
		super();

		this._register(this._authService.onDidChangeAuthState(state => this._onAuthStateChanged(state)));
		this._register(this._authService.onSessionWarning(countdown => this._onSessionWarning(countdown)));

		if (this._authService.state !== CiyexAuthState.Authenticated) {
			this._show();
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
		this._countdownInterval = setInterval(() => {
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
			clearInterval(this._countdownInterval);
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
		return document.body.classList.contains('vs-dark') ||
			document.body.classList.contains('hc-black') ||
			window.matchMedia('(prefers-color-scheme: dark)').matches;
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
			document.head.appendChild(this._styleEl);
		}

		let content: HTMLElement;
		if (this._step === 'warning') {
			content = this._buildWarning(c);
		} else if (this._step === 'locked') {
			content = this._buildLocked(c);
		} else if (this._step === 'authenticate') {
			content = this._buildAuthenticate(c);
		} else {
			content = this._buildEmailStep(c);
		}

		this._overlay.appendChild(content);
	}

	// --- Ciyex no-text logo (3D knot PNG) ---
	private _logo(size: number): HTMLElement {
		const container = h('div', { display: 'block', margin: '0 auto', width: `${size}px`, height: `${size}px` });
		const img = document.createElement('img');
		// Resolve from the workbench HTML location (out/vs/code/electron-browser/workbench/)
		// up to the app root, then into resources/
		img.src = '../../../../../resources/ciyex-logo-no-text.png';
		img.alt = 'Ciyex';
		Object.assign(img.style, { width: `${size}px`, height: `${size}px`, objectFit: 'contain' });
		container.appendChild(img);
		return container;
	}

	// --- Build helpers ---
	private _buildCard(c: ReturnType<typeof this._colors>): HTMLElement {
		return h('div', { background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: '12px', padding: '28px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' });
	}

	private _buildInput(id: string, type: string, placeholder: string, value: string, c: ReturnType<typeof this._colors>): HTMLInputElement {
		const input = document.createElement('input');
		input.id = id;
		input.type = type;
		input.placeholder = placeholder;
		input.value = value;
		if (this._loading) {
			input.disabled = true;
		}
		Object.assign(input.style, {
			width: '100%', padding: '10px 12px', borderRadius: '8px',
			border: `1px solid ${c.border}`, background: c.inputBg,
			color: c.textPrimary, fontSize: '14px', boxSizing: 'border-box',
			outline: 'none',
		});
		return input;
	}

	private _buildButton(id: string, label: string, primary: boolean, c: ReturnType<typeof this._colors>, disabled?: boolean): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.id = id;
		btn.disabled = !!disabled;
		btn.textContent = label;
		Object.assign(btn.style, {
			width: '100%', padding: '10px', borderRadius: '8px',
			fontSize: '14px', fontWeight: '700',
			display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
			border: primary ? 'none' : `1px solid ${c.border}`,
			background: primary ? c.brand : 'none',
			color: primary ? 'white' : c.textSecondary,
		});
		return btn;
	}

	private _buildError(c: ReturnType<typeof this._colors>): HTMLElement | null {
		if (!this._error) {
			return null;
		}
		const div = h('div', {
			background: c.errorBg, border: `1px solid ${c.errorBorder}`,
			borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
			fontSize: '13px', color: c.errorText,
		});
		div.textContent = this._error;
		return div;
	}

	// --- Step builders ---
	private _buildEmailStep(c: ReturnType<typeof this._colors>): HTMLElement {
		const wrapper = h('div', { width: '100%', maxWidth: '400px', padding: '16px' });

		// Header
		const header = h('div', { textAlign: 'center', marginBottom: '32px' });
		header.appendChild(this._logo(48));
		header.appendChild(text(h('h1', { fontSize: '22px', fontWeight: '700', color: c.textPrimary, margin: '12px 0 4px' }), 'Ciyex Workspace'));
		header.appendChild(text(h('p', { fontSize: '13px', color: c.textSecondary, margin: '0' }), 'Sign in to continue'));
		wrapper.appendChild(header);

		// Card
		const card = this._buildCard(c);

		// Email label + input
		const labelDiv = h('div', { marginBottom: '20px' });
		labelDiv.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '500', color: c.textPrimary, marginBottom: '6px' }), 'Email'));
		const emailInput = this._buildInput('ciyex-email', 'email', 'you@example.com', this._email, c);
		emailInput.autocomplete = 'email';
		labelDiv.appendChild(emailInput);
		card.appendChild(labelDiv);

		// Error
		const err = this._buildError(c);
		if (err) {
			card.appendChild(err);
		}

		// Continue button
		const btn = this._buildButton('ciyex-discover-btn', this._loading ? 'Checking...' : 'Continue', true, c, this._loading || !this._email.trim());
		card.appendChild(btn);
		wrapper.appendChild(card);

		// Server Settings link (opens popup)
		const settingsLink = document.createElement('button');
		settingsLink.id = 'ciyex-settings-toggle';
		settingsLink.textContent = '\u2699 Server Settings';
		Object.assign(settingsLink.style, {
			background: 'none', border: 'none', color: c.textSecondary,
			fontSize: '12px', padding: '8px 4px', cursor: 'pointer',
			display: 'block', margin: '12px auto 0', textAlign: 'center',
			textDecoration: 'underline',
		});
		wrapper.appendChild(settingsLink);

		// Settings popup overlay (modal on top of login)
		if (this._showSettings) {
			const backdrop = h('div', {
				position: 'fixed', inset: '0', zIndex: '100000',
				display: 'flex', alignItems: 'center', justifyContent: 'center',
				background: 'rgba(0,0,0,0.5)',
			});

			const popup = h('div', {
				background: c.cardBg, border: `1px solid ${c.border}`, borderRadius: '12px',
				padding: '24px', width: '380px', maxWidth: '90vw',
				boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
			});

			// Popup header
			const headerRow = h('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' });
			headerRow.appendChild(text(h('h3', { fontSize: '15px', fontWeight: '600', color: c.textPrimary, margin: '0' }), 'Server Settings'));
			const closeBtn = document.createElement('button');
			closeBtn.textContent = '\u2715';
			Object.assign(closeBtn.style, { background: 'none', border: 'none', color: c.textSecondary, fontSize: '16px', cursor: 'pointer', padding: '0 4px' });
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
				row.appendChild(text(h('label', { display: 'block', fontSize: '12px', fontWeight: '500', color: c.textSecondary, marginBottom: '4px' }), f.label));
				const inp = this._buildInput(`ciyex-cfg-${f.key}`, 'text', f.placeholder, f.value, c);
				inp.style.fontSize = '13px';
				inp.style.padding = '8px 10px';
				row.appendChild(inp);
				popup.appendChild(row);
				inputs.push(inp);
			}

			// Save button
			const saveBtn = this._buildButton('ciyex-settings-save', 'Save', true, c);
			saveBtn.style.marginTop = '4px';
			popup.appendChild(saveBtn);

			backdrop.appendChild(popup);
			this._overlay!.appendChild(backdrop);

			// Popup listeners
			const closePopup = () => { this._showSettings = false; this._render(); };
			closeBtn.addEventListener('click', closePopup);
			backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { closePopup(); } });
			saveBtn.addEventListener('click', () => {
				for (let i = 0; i < fields.length; i++) {
					const val = inputs[i].value.trim();
					if (val) {
						localStorage.setItem(fields[i].key, fields[i].key === 'ciyex_api_url' ? val.replace(/\/$/, '') : val);
					}
				}
				closePopup();
			});
		}

		// Listeners
		emailInput.addEventListener('input', () => { this._email = emailInput.value; });
		emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this._handleDiscover(); } });
		btn.addEventListener('click', () => this._handleDiscover());
		settingsLink.addEventListener('click', () => { this._showSettings = true; this._render(); });
		setTimeout(() => emailInput.focus(), 50);

		return wrapper;
	}

	private _buildAuthenticate(c: ReturnType<typeof this._colors>): HTMLElement {
		const wrapper = h('div', { width: '100%', maxWidth: '400px', padding: '16px' });

		// Header
		const header = h('div', { textAlign: 'center', marginBottom: '32px' });
		header.appendChild(this._logo(48));
		header.appendChild(text(h('h1', { fontSize: '22px', fontWeight: '700', color: c.textPrimary, margin: '12px 0 4px' }), 'Welcome back'));
		header.appendChild(text(h('p', { fontSize: '13px', color: c.textSecondary, margin: '0' }), this._email));
		if (this._discoverResult?.orgName) {
			header.appendChild(text(h('p', { fontSize: '12px', color: c.textSecondary, margin: '2px 0 0' }), this._discoverResult.orgName));
		}
		wrapper.appendChild(header);

		// Card
		const card = this._buildCard(c);

		// Back button
		const backBtn = document.createElement('button');
		backBtn.id = 'ciyex-back-btn';
		backBtn.textContent = '\u2190 Back';
		Object.assign(backBtn.style, { background: 'none', border: 'none', color: c.textSecondary, fontSize: '13px', padding: '0', marginBottom: '16px', cursor: 'pointer' });
		card.appendChild(backBtn);

		// Password field
		const pwDiv = h('div', { marginBottom: '20px' });
		pwDiv.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '500', color: c.textPrimary, marginBottom: '6px' }), 'Password'));
		const pwInput = this._buildInput('ciyex-password', this._showPassword ? 'text' : 'password', 'Enter your password', this._password, c);
		pwInput.style.paddingRight = '40px';
		pwInput.autocomplete = 'current-password';
		const pwWrap = h('div', { position: 'relative' });
		pwWrap.appendChild(pwInput);

		const toggleBtn = document.createElement('button');
		toggleBtn.id = 'ciyex-toggle-pw';
		toggleBtn.textContent = this._showPassword ? '\u25C9' : '\u25CE';
		Object.assign(toggleBtn.style, { position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: c.textSecondary, padding: '2px', fontSize: '16px', cursor: 'pointer' });
		pwWrap.appendChild(toggleBtn);
		pwDiv.appendChild(pwWrap);
		card.appendChild(pwDiv);

		// Error
		const err = this._buildError(c);
		if (err) {
			card.appendChild(err);
		}

		// Sign In button
		const loginBtn = this._buildButton('ciyex-login-btn', this._loading ? 'Signing in...' : 'Sign In', true, c, this._loading || !this._password);
		card.appendChild(loginBtn);

		// IDP buttons (Google, Microsoft, etc.) from discover response
		const idpButtons: HTMLButtonElement[] = [];
		if (this._discoverResult?.idps?.length) {
			const divider = h('div', { marginTop: '16px', paddingTop: '16px', borderTop: `1px solid ${c.border}`, textAlign: 'center' });
			divider.appendChild(text(h('span', { fontSize: '11px', color: c.textSecondary, opacity: '0.6' }), 'or sign in with'));
			card.appendChild(divider);

			const idpRow = h('div', { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' });
			for (const idp of this._discoverResult.idps) {
				const idpBtn = this._buildButton(`ciyex-idp-${idp.alias}`, `Continue with ${idp.displayName || idp.alias}`, false, c);
				idpBtn.style.fontSize = '13px';
				idpRow.appendChild(idpBtn);
				idpButtons.push(idpBtn);
			}
			card.appendChild(idpRow);
		}

		wrapper.appendChild(card);

		// Listeners
		backBtn.addEventListener('click', () => { this._step = 'email'; this._password = ''; this._error = ''; this._discoverResult = null; this._render(); });
		pwInput.addEventListener('input', () => { this._password = pwInput.value; });
		pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this._handleLogin(); } });
		toggleBtn.addEventListener('click', () => { this._showPassword = !this._showPassword; this._render(); });
		loginBtn.addEventListener('click', () => this._handleLogin());

		// IDP button listeners
		if (this._discoverResult?.idps) {
			for (let i = 0; i < idpButtons.length; i++) {
				const alias = this._discoverResult.idps[i].alias;
				idpButtons[i].addEventListener('click', () => this._handleIdpLogin(alias));
			}
		}

		setTimeout(() => pwInput.focus(), 50);

		return wrapper;
	}

	private _buildLocked(c: ReturnType<typeof this._colors>): HTMLElement {
		const wrapper = h('div', { width: '100%', maxWidth: '400px', padding: '16px' });

		// Header with lock icon
		const header = h('div', { textAlign: 'center', marginBottom: '32px' });
		header.appendChild(createSvg(48, '0 0 24 24', (svg) => {
			svg.setAttribute('stroke', '#465FFF');
			svg.setAttribute('stroke-width', '1.5');
			svgRect(svg, { x: '3', y: '11', width: '18', height: '11', rx: '2', ry: '2', fill: 'none' });
			svgPath(svg, 'M7 11V7a5 5 0 0110 0v4', { fill: 'none' });
			svgCircle(svg, { cx: '12', cy: '16', r: '1', fill: 'none' });
		}));
		header.appendChild(text(h('h1', { fontSize: '22px', fontWeight: '700', color: c.textPrimary, margin: '12px 0 4px' }), 'Session Locked'));
		header.appendChild(text(h('p', { fontSize: '13px', color: c.textSecondary, margin: '0' }), 'Your session has expired. Sign in again.'));
		if (this._email) {
			header.appendChild(text(h('p', { fontSize: '13px', color: c.textPrimary, margin: '8px 0 0', fontWeight: '500' }), this._email));
		}
		wrapper.appendChild(header);

		// Card
		const card = this._buildCard(c);
		const pwDiv = h('div', { marginBottom: '20px' });
		pwDiv.appendChild(text(h('label', { display: 'block', fontSize: '13px', fontWeight: '500', color: c.textPrimary, marginBottom: '6px' }), 'Password'));
		const pwInput = this._buildInput('ciyex-password', this._showPassword ? 'text' : 'password', 'Enter your password', this._password, c);
		pwInput.autocomplete = 'current-password';
		pwDiv.appendChild(pwInput);
		card.appendChild(pwDiv);

		const err = this._buildError(c);
		if (err) {
			card.appendChild(err);
		}

		const unlockBtn = this._buildButton('ciyex-login-btn', this._loading ? 'Signing in...' : 'Unlock', true, c, this._loading || !this._password);
		unlockBtn.style.marginBottom = '12px';
		card.appendChild(unlockBtn);

		const switchBtn = this._buildButton('ciyex-switch-account-btn', 'Sign in with a different account', false, c);
		card.appendChild(switchBtn);
		wrapper.appendChild(card);

		// Listeners
		pwInput.addEventListener('input', () => { this._password = pwInput.value; });
		pwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { this._handleLogin(); } });
		unlockBtn.addEventListener('click', () => this._handleLogin());
		switchBtn.addEventListener('click', () => this._authService.signOut());
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
		const stayBtn = this._buildButton('ciyex-stay-btn', 'Stay Logged In', true, c);
		stayBtn.style.flex = '1';
		const signOutBtn = this._buildButton('ciyex-signout-btn', 'Sign Out', false, c);
		signOutBtn.style.flex = '1';
		btnRow.appendChild(stayBtn);
		btnRow.appendChild(signOutBtn);
		card.appendChild(btnRow);
		wrapper.appendChild(card);

		// Listeners
		stayBtn.addEventListener('click', () => { this._clearCountdown(); this._authService.dismissWarning(); });
		signOutBtn.addEventListener('click', () => { this._clearCountdown(); this._authService.signOut(); });

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

		if (!result.success) {
			this._error = result.error || 'Login failed';
			this._render();
		}
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
