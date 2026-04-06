/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ICiyexApiService, CiyexApiService } from './ciyexApiService.js';
import { ICiyexPermissionService, CiyexPermissionService } from './ciyexPermissionService.js';
import { ICiyexMenuService, CiyexMenuService } from './ciyexMenuService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { CiyexEhrContribution } from './ciyexEhrContribution.js';

// Register services
registerSingleton(ICiyexApiService, CiyexApiService, InstantiationType.Delayed);
registerSingleton(ICiyexPermissionService, CiyexPermissionService, InstantiationType.Delayed);
registerSingleton(ICiyexMenuService, CiyexMenuService, InstantiationType.Delayed);

// Register the EHR workbench contribution (loads permissions, sets up menus)
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(CiyexEhrContribution, LifecyclePhase.Restored);
