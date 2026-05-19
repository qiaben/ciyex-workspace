/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICiyexApiService } from './ciyexApiService.js';

export const ICiyexInstallationsService = createDecorator<ICiyexInstallationsService>('ciyexInstallationsService');

/**
 * Marketplace app installation for the current org. Mirrors the shape returned
 * by GET /api/app-installations and the InstalledPlugin interface used by the
 * ciyex-ehr-ui PluginRegistryContext. A feature is available only when an
 * installation with `status === "active"` exists for its appSlug (i.e. the org
 * has purchased + installed the extension from the Hub/marketplace).
 */
export interface InstalledApp {
	id: string;
	appSlug: string;
	appName: string;
	appIconUrl?: string;
	appCategory?: string;
	status: string;
	config?: Record<string, unknown>;
	extensionPoints?: string[];
}

export interface ICiyexInstallationsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeInstallations: Event<void>;
	readonly installations: readonly InstalledApp[];
	readonly loaded: boolean;
	/** True if the appSlug has an active installation for the current org. */
	isInstalled(appSlug: string): boolean;
	getInstallation(appSlug: string): InstalledApp | undefined;
	loadInstallations(): Promise<void>;
	reset(): void;
}

/**
 * Tracks which marketplace apps the current org has purchased + installed.
 * Workbench features that ship as paid extensions (e.g. ciyex-telehealth,
 * ciyex-erx, ciyex-rcm) gate their UI on `isInstalled()` so an org cannot
 * use them until the extension is purchased + installed from the Hub.
 */
export class CiyexInstallationsService extends Disposable implements ICiyexInstallationsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeInstallations = this._register(new Emitter<void>());
	readonly onDidChangeInstallations: Event<void> = this._onDidChangeInstallations.event;

	private _installations: InstalledApp[] = [];
	private _loaded = false;

	constructor(@ICiyexApiService private readonly apiService: ICiyexApiService) {
		super();
	}

	get installations(): readonly InstalledApp[] { return this._installations; }
	get loaded(): boolean { return this._loaded; }

	isInstalled(appSlug: string): boolean {
		return this._installations.some(p => p.appSlug === appSlug && p.status === 'active');
	}

	getInstallation(appSlug: string): InstalledApp | undefined {
		return this._installations.find(p => p.appSlug === appSlug);
	}

	async loadInstallations(): Promise<void> {
		try {
			interface InstallationsEnvelope {
				success?: boolean;
				data?: InstalledApp[];
			}
			const raw = await this.apiService.fetchJson<InstallationsEnvelope | InstalledApp[]>('/api/app-installations');
			const list = Array.isArray(raw) ? raw : (raw.data || []);
			this._installations = list;
		} catch (err) {
			console.warn('[CiyexInstallations] Failed to load installations:', err);
			this._installations = [];
		}
		this._loaded = true;
		this._onDidChangeInstallations.fire();
	}

	reset(): void {
		this._installations = [];
		this._loaded = false;
		this._onDidChangeInstallations.fire();
	}
}
