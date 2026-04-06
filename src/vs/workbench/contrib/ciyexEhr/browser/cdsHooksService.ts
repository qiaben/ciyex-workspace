/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ILogService } from '../../../../platform/log/common/log.js';

export const ICdsHooksService = createDecorator<ICdsHooksService>('cdsHooksService');

/**
 * A CDS Hook card returned by a CDS service.
 */
export interface ICdsCard {
	summary: string;
	detail?: string;
	indicator: 'info' | 'warning' | 'critical';
	source: { label: string; url?: string };
	suggestions?: Array<{
		label: string;
		uuid?: string;
		actions?: Array<{
			type: string;
			description: string;
			resource?: Record<string, unknown>;
		}>;
	}>;
	links?: Array<{
		label: string;
		url: string;
		type: string;
	}>;
}

/**
 * A CDS Hook service definition from discovery.
 */
export interface ICdsService {
	id: string;
	hook: string;
	title: string;
	description: string;
	prefetch?: Record<string, string>;
}

export interface ICdsHooksService {
	readonly _serviceBrand: undefined;
	readonly onDidReceiveCards: Event<{ hook: string; cards: ICdsCard[] }>;

	/**
	 * Invoke a CDS hook (e.g., patient-view, order-sign)
	 */
	invoke(hook: string, context: Record<string, unknown>): Promise<ICdsCard[]>;

	/**
	 * Get discovered CDS services
	 */
	getServices(): Promise<ICdsService[]>;
}

export class CdsHooksService extends Disposable implements ICdsHooksService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidReceiveCards = this._register(new Emitter<{ hook: string; cards: ICdsCard[] }>());
	readonly onDidReceiveCards: Event<{ hook: string; cards: ICdsCard[] }> = this._onDidReceiveCards.event;

	private _services: ICdsService[] | null = null;

	constructor(
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getServices(): Promise<ICdsService[]> {
		if (this._services) {
			return this._services;
		}

		try {
			// Fetch installed apps that have CDS hooks
			const response = await this.apiService.fetch('/api/app-installations');
			if (!response.ok) {
				return [];
			}

			const data = await response.json();
			const apps = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
			const services: ICdsService[] = [];

			for (const app of apps) {
				if (app.cdsHooksDiscoveryUrl) {
					try {
						const discoverRes = await this.apiService.fetch(app.cdsHooksDiscoveryUrl);
						if (discoverRes.ok) {
							const discovered = await discoverRes.json();
							const appServices = discovered?.services || [];
							for (const svc of appServices) {
								services.push({
									id: `${app.appSlug}.${svc.id}`,
									hook: svc.hook,
									title: svc.title || svc.id,
									description: svc.description || '',
									prefetch: svc.prefetch,
								});
							}
						}
					} catch {
						this.logService.warn(`[CDS] Failed to discover hooks for ${app.appSlug}`);
					}
				}
			}

			this._services = services;
			this.logService.info(`[CDS] Discovered ${services.length} CDS services`);
			return services;
		} catch {
			return [];
		}
	}

	async invoke(hook: string, context: Record<string, unknown>): Promise<ICdsCard[]> {
		const services = await this.getServices();
		const matching = services.filter(s => s.hook === hook);

		if (matching.length === 0) {
			return [];
		}

		const allCards: ICdsCard[] = [];

		for (const service of matching) {
			try {
				// Build CDS request
				const request = {
					hookInstance: crypto.randomUUID(),
					hook,
					context,
					prefetch: {}, // TODO: Resolve prefetch templates
				};

				const response = await this.apiService.fetch(`/api/cds-hooks/${service.id}`, {
					method: 'POST',
					body: JSON.stringify(request),
				});

				if (response.ok) {
					const result = await response.json();
					const cards = result?.cards || [];
					allCards.push(...cards);
				}
			} catch {
				this.logService.warn(`[CDS] Failed to invoke ${service.id}`);
			}
		}

		if (allCards.length > 0) {
			this._onDidReceiveCards.fire({ hook, cards: allCards });
		}

		return allCards;
	}
}
