/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { ICiyexAuthService } from './ciyexAuthService.js';
import { CiyexAuthGate } from './ciyexAuthGate.js';
import { mainWindow } from '../../../../base/browser/window.js';

/**
 * Workbench contribution that creates the auth gate overlay.
 * Registered at LifecyclePhase.Restored so the workbench DOM is ready.
 */
export class CiyexAuthGateContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.ciyexAuthGate';

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ICiyexAuthService authService: ICiyexAuthService,
	) {
		super();

		// Attach the auth gate to the document body so it overlays everything
		this._register(new CiyexAuthGate(mainWindow.document.body, authService));
	}
}
