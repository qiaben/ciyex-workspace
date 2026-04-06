/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ICiyexAuthService, CiyexAuthService } from './ciyexAuthService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { CiyexAuthGateContribution } from './ciyexAuthGateContribution.js';

// Register the auth service as a singleton (Eager so it starts immediately)
registerSingleton(ICiyexAuthService, CiyexAuthService, InstantiationType.Eager);

// Register the auth gate workbench contribution
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(CiyexAuthGateContribution, LifecyclePhase.Restored);
