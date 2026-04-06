/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainer, ViewContainerLocation } from '../../../common/views.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { codiconsLibrary as Codicon } from '../../../../base/common/codiconsLibrary.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
// ContextKeyExpr used for RBAC gating when preconditions are re-enabled
// import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { PatientListPane } from './patientListPane.js';
import { GenericListPane } from './genericListPane.js';

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

// ─── Icons ───────────────────────────────────────────────────────────────

const calendarIcon = registerIcon('ciyex-calendar-icon', Codicon.calendar, localize('ciyexCalendarIcon', 'Ciyex Calendar view icon'));
const patientsIcon = registerIcon('ciyex-patients-icon', Codicon.organization, localize('ciyexPatientsIcon', 'Ciyex Patients view icon'));
const clinicalIcon = registerIcon('ciyex-clinical-icon', Codicon.beaker, localize('ciyexClinicalIcon', 'Ciyex Clinical view icon'));
const messagingIcon = registerIcon('ciyex-messaging-icon', Codicon.mail, localize('ciyexMessagingIcon', 'Ciyex Messaging view icon'));
const billingIcon = registerIcon('ciyex-billing-icon', Codicon.creditCard, localize('ciyexBillingIcon', 'Ciyex Billing view icon'));
const reportsIcon = registerIcon('ciyex-reports-icon', Codicon.graph, localize('ciyexReportsIcon', 'Ciyex Reports view icon'));
// Settings uses VS Code's built-in gear at bottom of activity bar - no separate container needed

// ─── View Containers (Activity Bar) ─────────────────────────────────────

// Calendar / Scheduling
export const CALENDAR_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.calendar',
	title: localize2('ciyexCalendar', "Calendar"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.calendar', {}]),
	icon: calendarIcon,
	order: 1,
	openCommandActionDescriptor: {
		id: 'ciyex.calendar',
		title: localize2('ciyexCalendar', "Calendar"),
	},
}, ViewContainerLocation.Sidebar);

// Patients
export const PATIENTS_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.patients',
	title: localize2('ciyexPatients', "Patients"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.patients', {}]),
	icon: patientsIcon,
	order: 2,
	openCommandActionDescriptor: {
		id: 'ciyex.patients',
		title: localize2('ciyexPatients', "Patients"),
	},
}, ViewContainerLocation.Sidebar);

// Clinical (Labs, Rx, Immunizations, Care Plans, Referrals)
export const CLINICAL_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.clinical',
	title: localize2('ciyexClinical', "Clinical"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.clinical', {}]),
	icon: clinicalIcon,
	order: 3,
}, ViewContainerLocation.Sidebar);

// Messaging
export const MESSAGING_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.messaging',
	title: localize2('ciyexMessaging', "Messaging"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.messaging', {}]),
	icon: messagingIcon,
	order: 4,
}, ViewContainerLocation.Sidebar);

// Billing
export const BILLING_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.billing',
	title: localize2('ciyexBilling', "Billing"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.billing', {}]),
	icon: billingIcon,
	order: 5,
}, ViewContainerLocation.Sidebar);

// Reports
export const REPORTS_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.reports',
	title: localize2('ciyexReports', "Reports"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.reports', {}]),
	icon: reportsIcon,
	order: 6,
}, ViewContainerLocation.Sidebar);

// Settings uses VS Code's built-in gear (bottom of activity bar)
// No separate ViewContainer needed - admin settings accessed via Command Palette

// ─── GenericListPane Configs ─────────────────────────────────────────────

// Configure each list pane with API path, columns, and click behavior
GenericListPane.configs.set('ciyex.calendar.today', {
	apiPath: `/api/appointments?date=${new Date().toISOString().split('T')[0]}`,
	columns: [{ key: 'patientName' }, { key: 'appointmentType' }, { key: 'status' }],
	avatarFields: ['patientFirstName', 'patientLastName'],
	emptyMessage: 'No appointments today',
});

GenericListPane.configs.set('ciyex.clinical.encounters', {
	apiPath: '/api/encounters',
	columns: [{ key: 'patientName' }, { key: 'type' }, { key: 'status' }],
	avatarFields: ['patientName', 'patientName'],
	emptyMessage: 'No encounters',
	onClickCommand: 'ciyex.openEncounter',
	onClickIdField: 'fhirId',
	onClickLabelField: 'patientName',
});

GenericListPane.configs.set('ciyex.clinical.prescriptions', {
	apiPath: '/api/prescriptions',
	columns: [{ key: 'patientName' }, { key: 'medicationName' }, { key: 'status' }],
	iconId: 'beaker',
	emptyMessage: 'No prescriptions',
});

GenericListPane.configs.set('ciyex.clinical.immunizations', {
	apiPath: '/api/immunizations',
	columns: [{ key: 'patientName' }, { key: 'vaccineName' }, { key: 'status' }],
	iconId: 'shield',
	emptyMessage: 'No immunizations',
});

GenericListPane.configs.set('ciyex.clinical.carePlans', {
	apiPath: '/api/care-plans',
	columns: [{ key: 'patientName' }, { key: 'title' }, { key: 'status' }],
	iconId: 'heart',
	emptyMessage: 'No care plans',
});

GenericListPane.configs.set('ciyex.clinical.referrals', {
	apiPath: '/api/referrals',
	columns: [{ key: 'patientName' }, { key: 'specialistName' }, { key: 'status' }],
	iconId: 'arrow-right',
	emptyMessage: 'No referrals',
});

GenericListPane.configs.set('ciyex.messaging.inbox', {
	apiPath: '/api/messages',
	columns: [{ key: 'subject' }, { key: 'from' }, { key: 'date' }],
	iconId: 'mail',
	emptyMessage: 'No messages',
});

GenericListPane.configs.set('ciyex.billing.payments', {
	apiPath: '/api/payments',
	columns: [{ key: 'patientName' }, { key: 'amount' }, { key: 'status' }],
	iconId: 'credit-card',
	emptyMessage: 'No payments',
});

GenericListPane.configs.set('ciyex.billing.claims', {
	apiPath: '/api/claims',
	columns: [{ key: 'patientName' }, { key: 'payerName' }, { key: 'status' }],
	iconId: 'file-text',
	emptyMessage: 'No claims',
});

GenericListPane.configs.set('ciyex.reports.dashboard', {
	apiPath: '/api/reports',
	columns: [{ key: 'name' }, { key: 'type' }],
	iconId: 'graph',
	emptyMessage: 'No reports available',
});

// ─── Views ──────────────────────────────────────────────────────────────

// Calendar views
viewsRegistry.registerViews([{
	id: 'ciyex.calendar.today',
	name: localize2('todayAppointments', "Today's Appointments"),
	ctorDescriptor: new SyncDescriptor(GenericListPane),
}], CALENDAR_CONTAINER);

// Patient views
viewsRegistry.registerViews([{
	id: PatientListPane.ID,
	name: localize2('patientList', "Patient List"),
	ctorDescriptor: new SyncDescriptor(PatientListPane),
}], PATIENTS_CONTAINER);

// Clinical views
viewsRegistry.registerViews([
	{ id: 'ciyex.clinical.encounters', name: localize2('encounters', "Encounters"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.prescriptions', name: localize2('prescriptions', "Prescriptions"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.immunizations', name: localize2('immunizations', "Immunizations"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.carePlans', name: localize2('carePlans', "Care Plans"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.referrals', name: localize2('referrals', "Referrals"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
], CLINICAL_CONTAINER);

// Messaging views
viewsRegistry.registerViews([
	{ id: 'ciyex.messaging.inbox', name: localize2('inbox', "Inbox"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
], MESSAGING_CONTAINER);

// Billing views
viewsRegistry.registerViews([
	{ id: 'ciyex.billing.payments', name: localize2('payments', "Payments"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.billing.claims', name: localize2('claims', "Claims"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
], BILLING_CONTAINER);

// Reports views
viewsRegistry.registerViews([
	{ id: 'ciyex.reports.dashboard', name: localize2('dashboard', "Dashboard"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
], REPORTS_CONTAINER);

// Settings: admin-only commands registered in ciyexCommands.ts
// Accessed via VS Code's built-in settings gear or Command Palette
