/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICiyexAuthService } from '../../ciyexAuth/browser/ciyexAuthService.js';

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

	async fetch(path: string, options?: RequestInit): Promise<Response> {
		// Block API calls without token — prevents hung connections before login
		if (!this._token && !path.includes('/auth/')) {
			throw new Error('Not authenticated');
		}
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
