/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ICiyexAuthService = createDecorator<ICiyexAuthService>('ciyexAuthService');

export interface ICiyexAuthService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeAuthState: Event<CiyexAuthState>;
	readonly onSessionWarning: Event<number>; // countdown seconds

	readonly state: CiyexAuthState;
	readonly userEmail: string | undefined;
	readonly apiUrl: string;
	readonly keycloakUrl: string;
	readonly keycloakRealm: string;
	readonly keycloakClientId: string;

	/**
	 * Step 1: Discover account by email
	 */
	discover(email: string): Promise<CiyexDiscoverResult>;

	/**
	 * Step 2a: Login with email + password
	 */
	login(email: string, password: string): Promise<CiyexLoginResult>;

	/**
	 * Step 2b: Login with Keycloak IDP (opens popup window for OAuth PKCE)
	 */
	keycloakLogin(email: string, idpAlias: string): Promise<CiyexLoginResult>;

	/**
	 * Refresh the access token
	 */
	refreshToken(): Promise<boolean>;

	/**
	 * Sign out and lock the workbench
	 */
	signOut(): void;

	/**
	 * Dismiss session warning and refresh
	 */
	dismissWarning(): Promise<void>;

	/**
	 * Record user activity (resets idle timer)
	 */
	recordActivity(): void;
}

export const enum CiyexAuthState {
	/** No token, login required */
	NotAuthenticated = 0,
	/** Authenticated and active */
	Authenticated = 1,
	/** Session expired or locked */
	Locked = 2,
	/** Session warning (about to expire) */
	Warning = 3
}

export interface CiyexDiscoverResult {
	exists: boolean;
	authMethods: string[];
	idps: Array<{ alias: string; displayName: string; providerId: string }>;
	orgAlias: string;
	orgName: string;
	error?: string;
}

export interface CiyexLoginResult {
	success: boolean;
	error?: string;
	requiresPasswordChange?: boolean;
	data?: {
		token: string;
		refreshToken: string;
		email: string;
		username: string;
		firstName: string;
		lastName: string;
		groups: string[];
		userId: string;
	};
}

// How early (in seconds) before JWT expiry to proactively refresh
const REFRESH_BEFORE_EXPIRY_SEC = 60;

// Default idle timeout (30 minutes)
const DEFAULT_IDLE_MINUTES = 30;

// Warning shown 2 minutes before idle timeout fires
const WARNING_BEFORE_MS = 2 * 60 * 1000;

function decodeJwt(token: string | null): { exp?: number; organization?: string | string[] } | null {
	if (!token) {
		return null;
	}
	try {
		const parts = token.split('.');
		if (parts.length < 2) {
			return null;
		}
		return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
	} catch {
		return null;
	}
}

export class CiyexAuthService extends Disposable implements ICiyexAuthService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeAuthState = this._register(new Emitter<CiyexAuthState>());
	readonly onDidChangeAuthState: Event<CiyexAuthState> = this._onDidChangeAuthState.event;

	private readonly _onSessionWarning = this._register(new Emitter<number>());
	readonly onSessionWarning: Event<number> = this._onSessionWarning.event;

	private _state: CiyexAuthState = CiyexAuthState.NotAuthenticated;
	private _userEmail: string | undefined;
	private _refreshTimerId: ReturnType<typeof setTimeout> | null = null;
	private _idleTimerId: ReturnType<typeof setTimeout> | null = null;
	private _warningTimerId: ReturnType<typeof setTimeout> | null = null;
	private _refreshPromise: Promise<boolean> | null = null;
	private _lastActivity: number = Date.now();
	private _idleMs: number;

	get state(): CiyexAuthState {
		return this._state;
	}

	get userEmail(): string | undefined {
		return this._userEmail;
	}

	get apiUrl(): string {
		try {
			const stored = localStorage.getItem('ciyex_api_url');
			if (stored) {
				return stored;
			}
		} catch { }
		return 'https://api-dev.ciyex.org';
	}

	get keycloakUrl(): string {
		try {
			const stored = localStorage.getItem('ciyex_keycloak_url');
			if (stored) {
				return stored;
			}
		} catch { }
		return 'https://dev.aran.me';
	}

	get keycloakRealm(): string {
		try {
			const stored = localStorage.getItem('ciyex_keycloak_realm');
			if (stored) {
				return stored;
			}
		} catch { }
		return 'ciyex';
	}

	get keycloakClientId(): string {
		try {
			const stored = localStorage.getItem('ciyex_keycloak_client_id');
			if (stored) {
				return stored;
			}
		} catch { }
		return 'ciyex-app';
	}

	constructor() {
		super();

		this._idleMs = DEFAULT_IDLE_MINUTES * 60 * 1000;

		// Check for existing valid token on startup
		this._checkExistingAuth();

		// Listen for activity events
		this._setupActivityListeners();
	}

	private _checkExistingAuth(): void {
		try {
			const token = localStorage.getItem('ciyex_token');
			if (token) {
				const decoded = decodeJwt(token);
				if (decoded?.exp && decoded.exp * 1000 > Date.now()) {
					this._userEmail = localStorage.getItem('ciyex_email') || undefined;
					this._setState(CiyexAuthState.Authenticated);
					this._scheduleTokenRefresh();
					this._resetIdleTimer();
					return;
				}
				// Token expired
				this._clearStoredAuth();
			}
		} catch { }
		this._setState(CiyexAuthState.NotAuthenticated);
	}

	private _setState(state: CiyexAuthState): void {
		if (this._state !== state) {
			this._state = state;
			this._onDidChangeAuthState.fire(state);
		}
	}

	async discover(email: string): Promise<CiyexDiscoverResult> {
		try {
			const res = await fetch(`${this.apiUrl}/api/auth/discover`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: email.trim() }),
			});

			if (!res.ok) {
				return { exists: false, authMethods: [], idps: [], orgAlias: '', orgName: '', error: 'Unable to verify your account.' };
			}

			return await res.json();
		} catch {
			return { exists: false, authMethods: [], idps: [], orgAlias: '', orgName: '', error: 'Unable to connect to server.' };
		}
	}

	async login(email: string, password: string): Promise<CiyexLoginResult> {
		try {
			const res = await fetch(`${this.apiUrl}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: email.trim(), password }),
			});

			const data = await res.json();

			if (data.success && data.data?.token) {
				this._storeAuth(data.data);
				this._userEmail = email;
				this._setState(CiyexAuthState.Authenticated);
				this._scheduleTokenRefresh();
				this._resetIdleTimer();
				return { success: true, data: data.data };
			} else if (data.requiresPasswordChange) {
				return { success: false, requiresPasswordChange: true };
			} else {
				return { success: false, error: data.error || 'Invalid email or password' };
			}
		} catch {
			return { success: false, error: 'Unable to connect to server.' };
		}
	}

	async keycloakLogin(email: string, idpAlias: string): Promise<CiyexLoginResult> {
		try {
			// Generate PKCE code verifier and challenge
			const array = new Uint8Array(32);
			crypto.getRandomValues(array);
			const codeVerifier = btoa(String.fromCharCode(...array))
				.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

			const encoder = new TextEncoder();
			const hash = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier));
			const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
				.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

			// Build Keycloak auth URL
			const redirectUri = `${this.apiUrl}/api/auth/keycloak-callback`;
			const authUrl = `${this.keycloakUrl}/realms/${this.keycloakRealm}/protocol/openid-connect/auth`;
			const params = new URLSearchParams({
				client_id: this.keycloakClientId,
				redirect_uri: redirectUri,
				response_type: 'code',
				scope: 'openid profile email organization',
				code_challenge: codeChallenge,
				code_challenge_method: 'S256',
				kc_idp_hint: idpAlias,
				login_hint: email,
			});

			// Open popup for Keycloak login
			const popup = window.open(
				`${authUrl}?${params.toString()}`,
				'ciyex-keycloak-login',
				'width=500,height=700,menubar=no,toolbar=no'
			);

			if (!popup) {
				return { success: false, error: 'Unable to open login window. Check popup blocker.' };
			}

			// Poll popup for redirect with auth code
			return new Promise<CiyexLoginResult>((resolve) => {
				const interval = setInterval(() => {
					try {
						if (popup.closed) {
							clearInterval(interval);
							resolve({ success: false, error: 'Login window was closed.' });
							return;
						}
						const url = popup.location.href;
						if (url && url.includes('code=')) {
							clearInterval(interval);
							popup.close();
							const code = new URL(url).searchParams.get('code');
							if (code) {
								// Exchange code for tokens via backend
								this._exchangeKeycloakCode(code, codeVerifier, redirectUri).then(resolve);
							} else {
								resolve({ success: false, error: 'No authorization code received.' });
							}
						}
					} catch {
						// Cross-origin - popup still on Keycloak domain, keep polling
					}
				}, 500);

				// Timeout after 5 minutes
				setTimeout(() => {
					clearInterval(interval);
					if (!popup.closed) {
						popup.close();
					}
					resolve({ success: false, error: 'Login timed out.' });
				}, 300000);
			});
		} catch {
			return { success: false, error: 'Failed to initiate SSO login.' };
		}
	}

	private async _exchangeKeycloakCode(code: string, codeVerifier: string, redirectUri: string): Promise<CiyexLoginResult> {
		try {
			const res = await fetch(`${this.apiUrl}/api/auth/keycloak-callback`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code, codeVerifier, redirectUri }),
			});

			const data = await res.json();
			if (data.success && data.data?.token) {
				this._storeAuth(data.data);
				this._userEmail = data.data.email || data.data.username || '';
				this._setState(CiyexAuthState.Authenticated);
				this._scheduleTokenRefresh();
				this._resetIdleTimer();
				return { success: true, data: data.data };
			}
			return { success: false, error: data.error || 'SSO login failed.' };
		} catch {
			return { success: false, error: 'Failed to exchange authorization code.' };
		}
	}

	async refreshToken(): Promise<boolean> {
		if (this._refreshPromise) {
			return this._refreshPromise;
		}

		this._refreshPromise = this._doRefresh();
		try {
			return await this._refreshPromise;
		} finally {
			this._refreshPromise = null;
		}
	}

	private async _doRefresh(): Promise<boolean> {
		const refreshToken = localStorage.getItem('ciyex_refresh_token');
		if (!refreshToken) {
			return false;
		}

		try {
			const res = await fetch(`${this.apiUrl}/api/auth/refresh`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ refreshToken }),
			});

			if (!res.ok) {
				return false;
			}

			const data = await res.json();
			if (data.success && data.data?.token) {
				localStorage.setItem('ciyex_token', data.data.token);
				if (data.data.refreshToken) {
					localStorage.setItem('ciyex_refresh_token', data.data.refreshToken);
				}
				return true;
			}
			return false;
		} catch {
			return false;
		}
	}

	signOut(): void {
		this._clearStoredAuth();
		this._clearTimers();
		this._userEmail = undefined;
		this._setState(CiyexAuthState.NotAuthenticated);
	}

	async dismissWarning(): Promise<void> {
		const ok = await this.refreshToken();
		if (ok) {
			this._setState(CiyexAuthState.Authenticated);
			this._scheduleTokenRefresh();
			this._resetIdleTimer();
		} else {
			// Refresh failed, lock
			this._setState(CiyexAuthState.Locked);
		}
	}

	recordActivity(): void {
		this._lastActivity = Date.now();
		if (this._state === CiyexAuthState.Authenticated) {
			this._resetIdleTimer();
		}
	}

	private _storeAuth(data: {
		token: string;
		refreshToken: string;
		email: string;
		username: string;
		firstName: string;
		lastName: string;
		groups: string[];
		userId: string;
	}): void {
		localStorage.setItem('ciyex_token', data.token);
		if (data.refreshToken) {
			localStorage.setItem('ciyex_refresh_token', data.refreshToken);
		}
		localStorage.setItem('ciyex_email', data.email || data.username || '');
		const fullName = `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.username || '';
		localStorage.setItem('ciyex_user_name', fullName);
		localStorage.setItem('ciyex_user_id', data.userId || '');
		localStorage.setItem('ciyex_groups', JSON.stringify(data.groups || []));
	}

	private _clearStoredAuth(): void {
		localStorage.removeItem('ciyex_token');
		localStorage.removeItem('ciyex_refresh_token');
		localStorage.removeItem('ciyex_email');
		localStorage.removeItem('ciyex_user_name');
		localStorage.removeItem('ciyex_user_id');
		localStorage.removeItem('ciyex_groups');
	}

	private _scheduleTokenRefresh(): void {
		if (this._refreshTimerId) {
			clearTimeout(this._refreshTimerId);
			this._refreshTimerId = null;
		}

		const token = localStorage.getItem('ciyex_token');
		const payload = decodeJwt(token);
		if (!payload?.exp) {
			return;
		}

		const nowSec = Math.floor(Date.now() / 1000);
		const secsUntilExpiry = payload.exp - nowSec;

		if (secsUntilExpiry <= 0) {
			// Already expired, try immediate refresh
			this.refreshToken().then(ok => {
				if (ok) {
					this._scheduleTokenRefresh();
				} else {
					this._setState(CiyexAuthState.Locked);
				}
			});
			return;
		}

		const refreshInMs = Math.max(secsUntilExpiry - REFRESH_BEFORE_EXPIRY_SEC, 0) * 1000;

		this._refreshTimerId = setTimeout(async () => {
			const ok = await this.refreshToken();
			if (ok) {
				this._scheduleTokenRefresh();
			} else {
				// Show warning with remaining seconds
				const t = localStorage.getItem('ciyex_token');
				const p = decodeJwt(t);
				const now2 = Math.floor(Date.now() / 1000);
				const left = p?.exp ? p.exp - now2 : 0;
				if (left > 0) {
					this._setState(CiyexAuthState.Warning);
					this._onSessionWarning.fire(left);
				} else {
					this._setState(CiyexAuthState.Locked);
				}
			}
		}, refreshInMs);
	}

	private _resetIdleTimer(): void {
		if (this._idleTimerId) {
			clearTimeout(this._idleTimerId);
			this._idleTimerId = null;
		}
		if (this._warningTimerId) {
			clearTimeout(this._warningTimerId);
			this._warningTimerId = null;
		}

		this._lastActivity = Date.now();

		// Warning before idle timeout
		const warningMs = Math.max(this._idleMs - WARNING_BEFORE_MS, 0);
		if (warningMs > 0) {
			this._warningTimerId = setTimeout(() => {
				const countdown = Math.floor(WARNING_BEFORE_MS / 1000);
				this._setState(CiyexAuthState.Warning);
				this._onSessionWarning.fire(countdown);
			}, warningMs);
		}

		this._idleTimerId = setTimeout(() => {
			// Double-check inactivity
			const elapsed = Date.now() - this._lastActivity;
			if (elapsed < this._idleMs) {
				this._resetIdleTimer();
				return;
			}
			this._setState(CiyexAuthState.Locked);
		}, this._idleMs);
	}

	private _setupActivityListeners(): void {
		const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
		const handler = () => this.recordActivity();
		for (const ev of events) {
			window.addEventListener(ev, handler, { passive: true });
		}
	}

	private _clearTimers(): void {
		if (this._refreshTimerId) {
			clearTimeout(this._refreshTimerId);
			this._refreshTimerId = null;
		}
		if (this._idleTimerId) {
			clearTimeout(this._idleTimerId);
			this._idleTimerId = null;
		}
		if (this._warningTimerId) {
			clearTimeout(this._warningTimerId);
			this._warningTimerId = null;
		}
	}

	override dispose(): void {
		this._clearTimers();
		super.dispose();
	}
}
