/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICiyexAuthService } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { tryHandleLocally } from './ciyexLocalApi.js';

export const ICiyexApiService = createDecorator<ICiyexApiService>('ciyexApiService');

export interface ICiyexApiService {
	readonly _serviceBrand: undefined;
	readonly apiUrl: string;
	fetch(path: string, options?: RequestInit): Promise<Response>;
	fetchJson<T>(path: string, options?: RequestInit): Promise<T>;
}

export class CiyexApiService extends Disposable implements ICiyexApiService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ICiyexAuthService private readonly _authService: ICiyexAuthService,
	) {
		super();
	}

	get apiUrl(): string {
		// Single source of truth: the auth service resolves the URL from the
		// selected channel (dev/stage/prod) via product.json's channels map,
		// with any localStorage override on top. Reading localStorage directly
		// here would silently fall back to dev when the user switches to a
		// channel whose override key is empty.
		return this._authService.apiUrl;
	}

	private get _token(): string {
		try {
			return localStorage.getItem('ciyex_token') || '';
		} catch {
			return '';
		}
	}

	private get _tenant(): string {
		try {
			return localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') || '';
		} catch {
			return '';
		}
	}

	/** Routes owned by the dedicated billing backend once it is deployed. */
	private static readonly _billingRoute = /^\/api\/(fee-sheets|price-levels)(\/|\?|$)/;

	/**
	 * Tri-state cache for whether the remote billing backend is reachable:
	 * `undefined` = not probed yet, `true` = serve from server, `false` =
	 * fall back to the in-app local store.
	 */
	private _billingBackendLive: boolean | undefined;

	async fetch(path: string, options?: RequestInit): Promise<Response> {
		// Price Level and Fee Sheet persist on the server so the data is shared
		// across devices and users. Until the billing backend is deployed, fall
		// back to the in-app local store (see _fetchBilling).
		if (CiyexApiService._billingRoute.test(path)) {
			return this._fetchBilling(path, options);
		}

		// Block API calls without token — prevents hung connections before login
		if (!this._token && !path.includes('/auth/')) {
			throw new Error('Not authenticated');
		}
		return this._fetchWithAuthRetry(path, options);
	}

	/**
	 * Run a request and transparently recover from a stale access token. The
	 * most common case is right after signing up a brand-new practice: the token
	 * returned by /api/auth/signup predates the user's organization membership,
	 * so the first data write (e.g. creating a patient) comes back 401 until the
	 * token is re-minted. We refresh once in place and retry so the call succeeds
	 * on the first attempt. Auth endpoints are excluded so a failed login/refresh
	 * doesn't loop.
	 */
	private async _fetchWithAuthRetry(path: string, options?: RequestInit): Promise<Response> {
		const response = await this._fetchOnce(path, options);
		if (response.status === 401 && !path.includes('/auth/')) {
			const refreshed = await this._authService.refreshToken();
			if (refreshed) {
				return this._fetchOnce(path, options);
			}
		}
		return response;
	}

	/**
	 * Serve a Price Level / Fee Sheet request from the server so the records are
	 * centrally persisted and visible on every device the user signs in from.
	 *
	 * Older deployments don't ship these endpoints yet — the generic dispatcher
	 * answers `500 "No endpoint <METHOD> <path>"` (or 404). In that case, and
	 * only that case, fall back to the in-app local store ({@link tryHandleLocally})
	 * so the feature keeps working until the billing backend is rolled out. The
	 * server/local decision is cached for the session to avoid re-probing on
	 * every call.
	 */
	private async _fetchBilling(path: string, options?: RequestInit): Promise<Response> {
		if (this._billingBackendLive !== false && this._token) {
			try {
				const res = await this._fetchWithAuthRetry(path, options);
				if (await this._serverOwnsRoute(res)) {
					this._billingBackendLive = true;
					return res;
				}
				// Endpoint not deployed — remember and fall through to local.
				this._billingBackendLive = false;
			} catch {
				// Network failure: use the local store for this call without
				// permanently disabling the server (it may just be a blip).
			}
		}
		const local = tryHandleLocally(path, options);
		if (local) {
			return local;
		}
		return new Response(JSON.stringify({ message: 'Billing service unavailable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	/**
	 * True when the server actually handles a route. A 2xx clearly does; a 404 or
	 * the generic dispatcher's `500 "No endpoint ..."` body means the route isn't
	 * mapped, so we should fall back to the local store. Any other error (401/403/
	 * 409/500-with-real-message) is a genuine server response and is surfaced.
	 */
	private async _serverOwnsRoute(res: Response): Promise<boolean> {
		if (res.ok) {
			return true;
		}
		if (res.status === 404) {
			return false;
		}
		try {
			const text = await res.clone().text();
			return !/no endpoint/i.test(text);
		} catch {
			return true;
		}
	}

	private async _fetchOnce(path: string, options?: RequestInit): Promise<Response> {
		const url = path.startsWith('http') ? path : `${this.apiUrl}${path}`;
		return globalThis.fetch(url, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this._token}`,
				...(this._tenant ? { 'X-Tenant-Name': this._tenant } : {}),
				...options?.headers,
			},
		});
	}

	async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
		const response = await this.fetch(path, options);
		if (!response.ok) {
			throw new Error(`API error ${response.status}: ${response.statusText}`);
		}
		return response.json();
	}
}
