/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL, getCiyexUpdateUrl, IUpdateURLOptions } from './abstractUpdateService.js';

export class LinuxUpdateService extends AbstractUpdateService {

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IProductService productService: IProductService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, false);
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string {
		const updateUrl = getCiyexUpdateUrl(this.productService, this.configurationService) ?? this.productService.updateUrl!;

		// Ciyex: when updateUrl points at a static JSON manifest (a GitHub
		// release asset published by CI), use it directly. We pick the
		// per-platform asset and compare commits inside transformResponse()
		// rather than relying on a dynamic update server. Same approach the
		// win32 service uses.
		if (updateUrl.endsWith('.json')) {
			return updateUrl;
		}

		return createUpdateURL(updateUrl, `linux-${process.arch}`, quality, commit, options);
	}

	/**
	 * Ciyex: convert a static manifest response into the IUpdate shape the
	 * rest of the update flow expects. Pass-through for dynamic update-server
	 * responses. Returns null when the running build is already the latest.
	 */
	private transformResponse(raw: unknown): IUpdate | null {
		if (!raw || typeof raw !== 'object') {
			return null;
		}
		const r = raw as { url?: string; version?: string; productVersion?: string; commit?: string; platforms?: Record<string, { url?: string; sha256?: string }>; publishedAt?: number };
		if (r.url && r.version && r.productVersion) {
			return r as IUpdate;
		}
		if (!r.commit || !r.platforms) {
			return null;
		}
		if (r.commit === this.productService.commit) {
			return null;
		}
		const platform = `linux-${process.arch}`;
		const asset = r.platforms[platform];
		if (!asset?.url) {
			return null;
		}
		return {
			url: asset.url,
			version: r.commit,
			productVersion: r.version ?? this.productService.version,
			sha256hash: asset.sha256,
			timestamp: r.publishedAt ? r.publishedAt * 1000 : Date.now(),
		};
	}

	protected doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;
		const url = this.buildUpdateFeedUrl(this.quality, this.productService.commit!, { background, internalOrg });
		this.setState(State.CheckingForUpdates(explicit));

		this.requestService.request({ url, callSite: 'updateService.linux.checkForUpdates' }, CancellationToken.None)
			.then<unknown>(asJson)
			.then(raw => {
				const update = this.transformResponse(raw);
				if (!update || !update.url || !update.version || !update.productVersion) {
					this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
				} else {
					this.setState(State.AvailableForDownload(update));
				}
			})
			.then(undefined, err => {
				this.logService.error(err);
				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(UpdateType.Archive, message));
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		// Use the download URL if available as we don't currently detect the package type that was
		// installed and the website download page is more useful than the tarball generally.
		if (this.productService.downloadUrl && this.productService.downloadUrl.length > 0) {
			this.nativeHostMainService.openExternal(undefined, this.productService.downloadUrl);
		} else if (state.update.url) {
			this.nativeHostMainService.openExternal(undefined, state.update.url);
		}

		this.setState(State.Idle(UpdateType.Archive));
	}
}
