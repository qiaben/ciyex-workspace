/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService, ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { CiyexChannelName, ICiyexChannel } from '../../../../base/common/product.js';
import { mainWindow } from '../../../../base/browser/window.js';

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
	 * Currently selected channel (dev/stage/prod). Drives the default
	 * API/Keycloak endpoints and which update manifest the auto-updater watches.
	 */
	readonly selectedChannel: CiyexChannelName;

	/**
	 * Channels declared in product.json — used by the login UI to render
	 * the channel dropdown. Empty object if product.json does not declare any.
	 */
	readonly availableChannels: Readonly<Record<CiyexChannelName, ICiyexChannel>>;

	/**
	 * Persist the channel selection and clear any per-field URL overrides that
	 * would otherwise shadow the new channel's defaults.
	 */
	setChannel(channel: CiyexChannelName): Promise<void>;

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
	 * Step 2c: Set a new password when Keycloak returned requiresPasswordChange.
	 * On success this also completes the login and stores the session token.
	 */
	changePassword(email: string, currentPassword: string, newPassword: string): Promise<CiyexLoginResult>;

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

// Default warning shown 2 minutes before idle timeout (now configurable via settings)

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

	get availableChannels(): Readonly<Record<CiyexChannelName, ICiyexChannel>> {
		const channels: Record<CiyexChannelName, ICiyexChannel> = Object.create(null);
		return this.productService.channels ?? channels;
	}

	get selectedChannel(): CiyexChannelName {
		const stored = this.configurationService.getValue<CiyexChannelName>('ciyex.channel');
		if (stored === 'dev' || stored === 'stage' || stored === 'prod') {
			return stored;
		}
		const fallback = this.productService.defaultChannel;
		if (fallback === 'dev' || fallback === 'stage' || fallback === 'prod') {
			return fallback;
		}
		return 'prod';
	}

	private get _channel(): ICiyexChannel | undefined {
		return this.availableChannels[this.selectedChannel];
	}

	get apiUrl(): string {
		try {
			const stored = localStorage.getItem('ciyex_api_url');
			if (stored) {
				return stored;
			}
		} catch { }
		return this._channel?.apiUrl ?? 'https://api-dev.ciyex.org';
	}

	get keycloakUrl(): string {
		try {
			const stored = localStorage.getItem('ciyex_keycloak_url');
			if (stored) {
				return stored;
			}
		} catch { }
		return this._channel?.keycloakUrl ?? 'https://dev.aran.me';
	}

	get keycloakRealm(): string {
		try {
			const stored = localStorage.getItem('ciyex_keycloak_realm');
			if (stored) {
				return stored;
			}
		} catch { }
		return this._channel?.keycloakRealm ?? 'ciyex';
	}

	get keycloakClientId(): string {
		try {
			const stored = localStorage.getItem('ciyex_keycloak_client_id');
			if (stored) {
				return stored;
			}
		} catch { }
		return this._channel?.keycloakClientId ?? 'ciyex-app';
	}

	async setChannel(channel: CiyexChannelName): Promise<void> {
		// Wipe the per-field URL overrides so the channel's defaults take effect.
		// Without this, a Server-Settings override from a previous channel would
		// silently shadow the new selection.
		try {
			localStorage.removeItem('ciyex_api_url');
			localStorage.removeItem('ciyex_keycloak_url');
			localStorage.removeItem('ciyex_keycloak_realm');
			localStorage.removeItem('ciyex_keycloak_client_id');
		} catch { }
		// Clear tokens — different channel = different identity provider.
		this._clearStoredAuth();
		await this.configurationService.updateValue('ciyex.channel', channel, ConfigurationTarget.APPLICATION);
	}

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IProductService private readonly productService: IProductService,
	) {
		super();

		// Read idle timeout from VS Code settings (Cmd+, -> ciyex.session.idleTimeoutMinutes)
		const idleMinutes = this.configurationService.getValue<number>('ciyex.session.idleTimeoutMinutes') || DEFAULT_IDLE_MINUTES;
		this._idleMs = idleMinutes * 60 * 1000;

		// Listen for settings changes
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('ciyex.session.idleTimeoutMinutes')) {
				const newMinutes = this.configurationService.getValue<number>('ciyex.session.idleTimeoutMinutes') || DEFAULT_IDLE_MINUTES;
				this._idleMs = newMinutes * 60 * 1000;
				if (this._state === CiyexAuthState.Authenticated) {
					this._resetIdleTimer();
				}
			}
		}));

		// Check for existing valid session
		const loginRequired = this.configurationService.getValue<boolean>('ciyex.session.loginRequired');
		if (loginRequired === false) {
			// Skip login if token is still valid
			this._checkExistingAuth();
		} else {
			// Require password on startup - keep email, clear only tokens
			const savedEmail = localStorage.getItem('ciyex_email');
			this._clearTokensOnly();
			if (savedEmail) {
				this._userEmail = savedEmail;
				// Go to locked state (shows password-only screen, not email step)
				this._setState(CiyexAuthState.Locked);
			} else {
				this._setState(CiyexAuthState.NotAuthenticated);
			}
		}

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
		const changed = this._state !== state;
		this._state = state;
		// Always fire on Authenticated (handles re-login / session unlock where state was already Authenticated)
		if (changed || state === CiyexAuthState.Authenticated) {
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
				return { exists: false, authMethods: [], idps: [], orgAlias: '', orgName: '', error: `Unable to verify your account (HTTP ${res.status}).` };
			}

			return await res.json();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { exists: false, authMethods: [], idps: [], orgAlias: '', orgName: '', error: `Unable to connect to server: ${msg}` };
		}
	}

	async login(email: string, password: string): Promise<CiyexLoginResult> {
		const trimmedEmail = email.trim();
		try {
			const res = await fetch(`${this.apiUrl}/api/auth/login`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: trimmedEmail, password }),
			});

			let data: { success?: boolean; error?: string; requiresPasswordChange?: boolean; data?: CiyexLoginResult['data'] };
			try {
				data = await res.json();
			} catch {
				return { success: false, error: `Server returned ${res.status} with no body. Check API server settings.` };
			}

			if (data.success && data.data?.token) {
				this._storeAuth(data.data);
				this._userEmail = trimmedEmail;
				this._setState(CiyexAuthState.Authenticated);
				this._scheduleTokenRefresh();
				this._resetIdleTimer();
				return { success: true, data: data.data };
			}
			if (data.requiresPasswordChange) {
				// Stash the temp password so the change-password call can use it
				// as `currentPassword` without asking the user to retype it.
				this._userEmail = trimmedEmail;
				return { success: false, requiresPasswordChange: true };
			}
			return { success: false, error: data.error || `Invalid email or password (HTTP ${res.status}).` };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { success: false, error: `Unable to connect to server: ${msg}` };
		}
	}

	async changePassword(email: string, currentPassword: string, newPassword: string): Promise<CiyexLoginResult> {
		const trimmedEmail = email.trim();
		try {
			const res = await fetch(`${this.apiUrl}/api/auth/change-password`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: trimmedEmail,
					currentPassword,
					newPassword,
				}),
			});

			let data: { success?: boolean; error?: string; data?: CiyexLoginResult['data'] };
			try {
				data = await res.json();
			} catch {
				return { success: false, error: `Server returned ${res.status} with no body. Check API server settings.` };
			}

			if (data.success && data.data?.token) {
				this._storeAuth(data.data);
				this._userEmail = trimmedEmail;
				this._setState(CiyexAuthState.Authenticated);
				this._scheduleTokenRefresh();
				this._resetIdleTimer();
				return { success: true, data: data.data };
			}
			return { success: false, error: data.error || `Failed to set new password (HTTP ${res.status}).` };
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			return { success: false, error: `Unable to connect to server: ${msg}` };
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
			const popup = mainWindow.open(
				`${authUrl}?${params.toString()}`,
				'ciyex-keycloak-login',
				'width=500,height=700,menubar=no,toolbar=no'
			);

			if (!popup) {
				return { success: false, error: 'Unable to open login window. Check popup blocker.' };
			}

			// Poll popup for redirect with auth code
			return new Promise<CiyexLoginResult>((resolve) => {
				const interval = mainWindow.setInterval(() => {
					try {
						if (popup.closed) {
							mainWindow.clearInterval(interval);
							resolve({ success: false, error: 'Login window was closed.' });
							return;
						}
						const url = popup.location.href;
						if (url && url.includes('code=')) {
							mainWindow.clearInterval(interval);
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
					mainWindow.clearInterval(interval);
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

			// Proactively refresh if token is close to expiry and user is active
			const token = localStorage.getItem('ciyex_token');
			const payload = decodeJwt(token);
			if (payload?.exp) {
				const secsLeft = payload.exp - Math.floor(Date.now() / 1000);
				if (secsLeft > 0 && secsLeft < REFRESH_BEFORE_EXPIRY_SEC * 2) {
					// Token expires within 2 minutes and user is active - refresh now
					this.refreshToken().then(ok => {
						if (ok) {
							this._scheduleTokenRefresh();
						}
					});
				}
			}
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
		// Clear tenant scope so the next user's API requests don't carry
		// the previous user's X-Tenant-Name header.
		localStorage.removeItem('ciyex_selected_tenant');
		localStorage.removeItem('ciyex_tenant');
	}

	/** Clear tokens only - keep email and user name for password-only re-login */
	private _clearTokensOnly(): void {
		localStorage.removeItem('ciyex_token');
		localStorage.removeItem('ciyex_refresh_token');
		// Keep: ciyex_email, ciyex_user_name, ciyex_user_id, ciyex_groups
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

		// Warning before idle timeout (configurable via ciyex.session.warningMinutes)
		const warningMinutes = this.configurationService.getValue<number>('ciyex.session.warningMinutes') || 2;
		const warningBeforeMs = warningMinutes * 60 * 1000;
		const warningMs = Math.max(this._idleMs - warningBeforeMs, 0);
		if (warningMs > 0) {
			this._warningTimerId = setTimeout(() => {
				const countdown = Math.floor(warningBeforeMs / 1000);
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
			mainWindow.addEventListener(ev, handler, { passive: true });
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
