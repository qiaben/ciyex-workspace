/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { ICiyexInstallationsService } from '../ciyexInstallationsService.js';

export const ICiyexRcmApiService = createDecorator<ICiyexRcmApiService>('ciyexRcmApiService');

/** Marketplace app slug gating every RCM surface in the workbench. */
export const RCM_APP_SLUG = 'ciyex-rcm';

/**
 * Context key mirroring `ICiyexInstallationsService.isInstalled('ciyex-rcm')`.
 * Bound + kept in sync by `CiyexEhrContribution`; RCM views declare it in
 * their `when` clause and RCM commands in their `precondition` so the whole
 * module appears only for orgs that purchased the RCM app from the Hub.
 */
export const CONTEXT_RCM_INSTALLED = new RawContextKey<boolean>('ciyex.rcmInstalled', false);

/**
 * Transport for the ciyex-rcm microservice (claims, denials, eligibility,
 * ERA, work queue, reports — see /api/rcm/** in the RCM backend).
 *
 * All calls go through the main ciyex backend's app-proxy
 * (`/api/app-proxy/ciyex-rcm/api/rcm/...`): the proxy resolves the RCM
 * service URL from the org's app_installations row, forwards the bearer
 * token, and injects `X-Org-Alias` server-side from the caller's tenant —
 * the client must NOT send its own X-Org-Alias here (the proxy owns it).
 * Bearer token, X-Tenant-Name and 401-refresh come from ICiyexApiService.
 *
 * Dev override: set localStorage `ciyex_rcm_direct_url` (e.g.
 * `http://localhost:8082`) to bypass the proxy and hit a locally running
 * RCM service directly — in that mode we DO add X-Org-Alias ourselves
 * since no proxy is in the path.
 */
export interface ICiyexRcmApiService {
	readonly _serviceBrand: undefined;
	/** True when the current org has an active ciyex-rcm installation. */
	isAvailable(): boolean;
	/** Fetch an `/api/rcm/...` path through the app-proxy (or dev override). */
	fetch(path: string, options?: RequestInit): Promise<Response>;
	fetchJson<T>(path: string, options?: RequestInit): Promise<T>;
	/**
	 * Unwrap the RCM backend's ApiResponse/Page envelopes to a plain array:
	 * `{data:{content:[...]}}`, `{data:[...]}`, `{content:[...]}` or `[...]`.
	 */
	listOf(payload: unknown): Array<Record<string, unknown>>;
}

const RCM_PROXY_PREFIX = '/api/app-proxy/ciyex-rcm';

export class CiyexRcmApiService extends Disposable implements ICiyexRcmApiService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICiyexInstallationsService private readonly installationsService: ICiyexInstallationsService,
	) {
		super();
	}

	isAvailable(): boolean {
		return this.installationsService.isInstalled(RCM_APP_SLUG);
	}

	private _directUrl(): string {
		try {
			return localStorage.getItem('ciyex_rcm_direct_url') || '';
		} catch {
			return '';
		}
	}

	async fetch(path: string, options?: RequestInit): Promise<Response> {
		const direct = this._directUrl();
		if (direct) {
			// Local/dev direct mode — no proxy, so supply the org alias ourselves
			// (mirrors the telehealth proxy command's derivation).
			let orgAlias = '';
			try { orgAlias = localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') || ''; } catch { /* */ }
			return this.apiService.fetch(`${direct.replace(/\/$/, '')}${path}`, {
				...options,
				headers: { ...(orgAlias ? { 'X-Org-Alias': orgAlias } : {}), ...options?.headers },
			});
		}
		return this.apiService.fetch(`${RCM_PROXY_PREFIX}${path}`, options);
	}

	async fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
		const response = await this.fetch(path, options);
		if (!response.ok) {
			throw new Error(`RCM API error ${response.status}: ${response.statusText}`);
		}
		return response.json();
	}

	listOf(payload: unknown): Array<Record<string, unknown>> {
		const p = payload as { data?: { content?: unknown[] } | unknown[]; content?: unknown[] } | unknown[] | null;
		if (Array.isArray(p)) { return p as Array<Record<string, unknown>>; }
		const data = p?.data;
		if (Array.isArray(data)) { return data as Array<Record<string, unknown>>; }
		const nested = (data as { content?: unknown[] } | undefined)?.content ?? p?.content;
		return Array.isArray(nested) ? nested as Array<Record<string, unknown>> : [];
	}
}
