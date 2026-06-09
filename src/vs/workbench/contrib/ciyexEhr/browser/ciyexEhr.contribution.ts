/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ICiyexApiService, CiyexApiService } from './ciyexApiService.js';
import { ICiyexPermissionService, CiyexPermissionService } from './ciyexPermissionService.js';
import { ICiyexMenuService, CiyexMenuService } from './ciyexMenuService.js';
import { ICdsHooksService, CdsHooksService } from './cdsHooksService.js';
import { ICiyexInstallationsService, CiyexInstallationsService } from './ciyexInstallationsService.js';
import { ICiyexPaymentService, CiyexPaymentService } from './ciyexPaymentService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { CiyexEhrContribution } from './ciyexEhrContribution.js';

// Friendly-scroll + pagination styles applied to every Ciyex editor pane
import './media/ciyexCommon.css';

// Register EHR ViewContainers in Activity Bar (Calendar, Patients, Clinical, etc.)
import './ciyexViewContainers.js';

// Register EHR commands (openPatientChart, newPatient, newAppointment, openCalendar)
import './ciyexCommands.js';

// Register patient search (Cmd+K)
import './patientSearch.js';
// Register "Send Intake Form to Patient"
import './intakeForm.js';

// Register settings commands and Admin menu
import './ciyexSettingsCommands.js';

// Register Ciyex settings in VS Code Settings Editor (Cmd+,)
import './ciyexSettings.js';

// Register visual editors for .ciyex config files (Layout, Encounter, Fields, etc.)
import './editors/ciyexEditors.contribution.js';

// Register Config Explorer sidebar (gear icon in activity bar)
import './ciyexConfigExplorer.js';

// .ciyex config files also openable from Settings UI or file explorer
// (previously removed, now re-enabled as clickable directory — configs accessible via Cmd+, settings)

// Register services
registerSingleton(ICiyexApiService, CiyexApiService, InstantiationType.Delayed);
registerSingleton(ICiyexPermissionService, CiyexPermissionService, InstantiationType.Delayed);
registerSingleton(ICiyexMenuService, CiyexMenuService, InstantiationType.Delayed);
registerSingleton(ICdsHooksService, CdsHooksService, InstantiationType.Delayed);
registerSingleton(ICiyexInstallationsService, CiyexInstallationsService, InstantiationType.Delayed);
// Eager: payment gateway extensions activate on `onStartupFinished` and
// call back into `ciyex.payment.registerGateway` very early. The registry
// must be instantiated before the first such call lands.
registerSingleton(ICiyexPaymentService, CiyexPaymentService, InstantiationType.Eager);

// Register the EHR workbench contribution (loads permissions, sets up menus)
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(CiyexEhrContribution, LifecyclePhase.Restored);
