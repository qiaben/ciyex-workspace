/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';

/**
 * Ciyex add/edit forms render as ordinary DOM overlays
 * (`.ciyex-edit-dialog-overlay`) on top of the workbench. Their scrim dims the
 * workbench, and `ciyexCommon.css` dims the (DOM) title bar — but the
 * minimize / maximize / close buttons are drawn *natively* by the OS via the
 * Window Controls Overlay, so no CSS can reach them and they stayed bright.
 *
 * VS Code already exposes {@link IHostService.setWindowDimmed} to dim those
 * native caption buttons (it is what the built-in modal dialogs / modal editor
 * use). This contribution watches the main window for any open Ciyex form
 * overlay and toggles that native dimming to match, so the window controls dim
 * in step with the rest of the screen. On web `setWindowDimmed` is a no-op.
 */
export class CiyexWindowControlsDimmer extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.ciyexWindowControlsDimmer';

	/** Class names of the Ciyex modal overlays whose presence should dim the window controls. */
	private static readonly OVERLAY_SELECTOR = '.ciyex-edit-dialog-overlay';

	private dimmed = false;

	constructor(
		@IHostService private readonly hostService: IHostService
	) {
		super();

		const observer = new MutationObserver(() => this.update());
		observer.observe(mainWindow.document.body, { childList: true, subtree: true });
		this._register({ dispose: () => observer.disconnect() });

		// Make sure we leave the controls undimmed when the workbench shuts down.
		this._register({ dispose: () => this.setDimmed(false) });

		this.update();
	}

	private update(): void {
		// The overlays are created as plain DOM by various Ciyex form helpers, so a
		// selector check is the only way to detect them from here.
		// eslint-disable-next-line no-restricted-syntax
		const open = mainWindow.document.querySelector(CiyexWindowControlsDimmer.OVERLAY_SELECTOR) !== null;
		this.setDimmed(open);
	}

	private setDimmed(dimmed: boolean): void {
		if (dimmed === this.dimmed) {
			return;
		}
		this.dimmed = dimmed;
		this.hostService.setWindowDimmed(mainWindow, dimmed);
	}
}
