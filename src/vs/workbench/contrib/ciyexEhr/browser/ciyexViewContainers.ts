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
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { TreeViewPane } from '../../../browser/parts/views/treeView.js';
import { PatientListPane } from './patientListPane.js';

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

// ─── Icons ───────────────────────────────────────────────────────────────

const calendarIcon = registerIcon('ciyex-calendar-icon', Codicon.calendar, localize('ciyexCalendarIcon', 'Ciyex Calendar view icon'));
const patientsIcon = registerIcon('ciyex-patients-icon', Codicon.person, localize('ciyexPatientsIcon', 'Ciyex Patients view icon'));
const clinicalIcon = registerIcon('ciyex-clinical-icon', Codicon.beaker, localize('ciyexClinicalIcon', 'Ciyex Clinical view icon'));
const messagingIcon = registerIcon('ciyex-messaging-icon', Codicon.mail, localize('ciyexMessagingIcon', 'Ciyex Messaging view icon'));
const billingIcon = registerIcon('ciyex-billing-icon', Codicon.creditCard, localize('ciyexBillingIcon', 'Ciyex Billing view icon'));
const reportsIcon = registerIcon('ciyex-reports-icon', Codicon.graph, localize('ciyexReportsIcon', 'Ciyex Reports view icon'));
const settingsIcon = registerIcon('ciyex-settings-icon', Codicon.settingsGear, localize('ciyexSettingsIcon', 'Ciyex Settings view icon'));

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

// Settings (admin only)
export const SETTINGS_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: 'ciyex.settings',
	title: localize2('ciyexSettings', "Settings"),
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.settings', {}]),
	icon: settingsIcon,
	order: 7,
}, ViewContainerLocation.Sidebar);

// ─── Views ──────────────────────────────────────────────────────────────

// Calendar views
viewsRegistry.registerViews([
	{
		id: 'ciyex.calendar.today',
		name: localize2('todayAppointments', "Today's Appointments"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.scheduling'),
	},
], CALENDAR_CONTAINER);

// Patient views
viewsRegistry.registerViews([
	{
		id: PatientListPane.ID,
		name: localize2('patientList', "Patient List"),
		ctorDescriptor: new SyncDescriptor(PatientListPane),
	},
], PATIENTS_CONTAINER);

// Clinical views
viewsRegistry.registerViews([
	{
		id: 'ciyex.clinical.encounters',
		name: localize2('encounters', "Encounters"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.chart'),
	},
	{
		id: 'ciyex.clinical.labs',
		name: localize2('labOrders', "Lab Orders"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.orders'),
	},
	{
		id: 'ciyex.clinical.prescriptions',
		name: localize2('prescriptions', "Prescriptions"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.rx'),
	},
	{
		id: 'ciyex.clinical.immunizations',
		name: localize2('immunizations', "Immunizations"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.rx'),
		hideByDefault: true,
	},
	{
		id: 'ciyex.clinical.carePlans',
		name: localize2('carePlans', "Care Plans"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.chart'),
		hideByDefault: true,
	},
	{
		id: 'ciyex.clinical.referrals',
		name: localize2('referrals', "Referrals"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.chart'),
		hideByDefault: true,
	},
], CLINICAL_CONTAINER);

// Messaging views
viewsRegistry.registerViews([
	{
		id: 'ciyex.messaging.inbox',
		name: localize2('inbox', "Inbox"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.messaging'),
	},
	{
		id: 'ciyex.messaging.fax',
		name: localize2('fax', "Fax"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.messaging'),
		hideByDefault: true,
	},
], MESSAGING_CONTAINER);

// Billing views
viewsRegistry.registerViews([
	{
		id: 'ciyex.billing.payments',
		name: localize2('payments', "Payments"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.billing'),
	},
	{
		id: 'ciyex.billing.claims',
		name: localize2('claims', "Claims"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.billing'),
	},
], BILLING_CONTAINER);

// Reports views
viewsRegistry.registerViews([
	{
		id: 'ciyex.reports.dashboard',
		name: localize2('dashboard', "Dashboard"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.perm.reports'),
	},
], REPORTS_CONTAINER);

// Settings views (admin only)
viewsRegistry.registerViews([
	{
		id: 'ciyex.settings.users',
		name: localize2('userManagement', "User Management"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.role.admin'),
	},
	{
		id: 'ciyex.settings.roles',
		name: localize2('rolesPermissions', "Roles & Permissions"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.role.admin'),
	},
	{
		id: 'ciyex.settings.menuConfig',
		name: localize2('menuConfiguration', "Menu Configuration"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.role.admin'),
	},
	{
		id: 'ciyex.settings.layoutSettings',
		name: localize2('layoutSettings', "Layout Settings"),
		ctorDescriptor: new SyncDescriptor(TreeViewPane),
		when: ContextKeyExpr.has('ciyex.role.admin'),
	},
], SETTINGS_CONTAINER);
