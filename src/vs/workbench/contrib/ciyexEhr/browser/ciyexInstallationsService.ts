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
	/**
	 * True if the app is available to the org — either an active marketplace
	 * installation exists, OR the app's bundled workbench extension is enabled
	 * (see {@link setExtensionEnabled}). The extension path lets a feature like
	 * RCM be toggled on/off straight from the Extensions view, exactly like
	 * telehealth and the payment gateways, without a marketplace round-trip.
	 */
	isInstalled(appSlug: string): boolean;
	getInstallation(appSlug: string): InstalledApp | undefined;
	loadInstallations(): Promise<void>;
	/**
	 * Record whether the app's workbench extension is currently enabled. Called
	 * by the extension's activate()/deactivate() (via a workbench command) so
	 * enabling/disabling it in the Extensions view flips the feature live. Fires
	 * {@link onDidChangeInstallations} so context keys and gated UI update.
	 */
	setExtensionEnabled(appSlug: string, enabled: boolean): void;
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
	/** appSlugs whose bundled workbench extension is currently enabled. */
	private readonly _extensionEnabled = new Set<string>();

	constructor(@ICiyexApiService private readonly apiService: ICiyexApiService) {
		super();
	}

	get installations(): readonly InstalledApp[] { return this._installations; }
	get loaded(): boolean { return this._loaded; }

	isInstalled(appSlug: string): boolean {
		if (this._extensionEnabled.has(appSlug)) { return true; }
		return this._installations.some(p => p.appSlug === appSlug && p.status === 'active');
	}

	setExtensionEnabled(appSlug: string, enabled: boolean): void {
		const changed = enabled ? !this._extensionEnabled.has(appSlug) : this._extensionEnabled.has(appSlug);
		if (enabled) { this._extensionEnabled.add(appSlug); } else { this._extensionEnabled.delete(appSlug); }
		if (changed) { this._onDidChangeInstallations.fire(); }
	}

	getInstallation(appSlug: string): InstalledApp | undefined {
		return this._installations.find(p => p.appSlug === appSlug);
	}

	async loadInstallations(): Promise<void> {
		interface InstallationsEnvelope {
			success?: boolean;
			data?: InstalledApp[];
		}
		// This is called once per session from the auth flow. A single transient
		// failure (Cloudflare challenge, network blip, cold backend) previously
		// left installations empty for the whole session with no recovery — which
		// silently disabled paid features like RCM and telehealth even for orgs
		// that own them. Retry a few times with backoff before giving up.
		const attempts = 4;
		for (let i = 0; i < attempts; i++) {
			try {
				const raw = await this.apiService.fetchJson<InstallationsEnvelope | InstalledApp[]>('/api/app-installations');
				const list = Array.isArray(raw) ? raw : (raw.data || []);
				this._installations = list;
				this._loaded = true;
				this._onDidChangeInstallations.fire();
				return;
			} catch (err) {
				if (i === attempts - 1) {
					console.warn('[CiyexInstallations] Failed to load installations after retries:', err);
					this._installations = [];
				} else {
					await new Promise(r => setTimeout(r, 1000 * (i + 1)));
				}
			}
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
