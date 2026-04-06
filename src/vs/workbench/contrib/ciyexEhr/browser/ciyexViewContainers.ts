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
import { PatientListPane } from './patientListPane.js';
import { GenericListPane } from './genericListPane.js';

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

// ─── Icons (mapped from Lucide names in API to VS Code codicons) ─────

const icons: Record<string, ReturnType<typeof registerIcon>> = {
	calendar: registerIcon('ciyex-calendar', Codicon.calendar, localize('cCalendar', 'Calendar')),
	appointments: registerIcon('ciyex-appointments', Codicon.checklist, localize('cAppointments', 'Appointments')),
	patients: registerIcon('ciyex-patients', Codicon.organization, localize('cPatients', 'Patients')),
	encounters: registerIcon('ciyex-encounters', Codicon.book, localize('cEncounters', 'Encounters')),
	tasks: registerIcon('ciyex-tasks', Codicon.tasklist, localize('cTasks', 'Tasks')),
	messaging: registerIcon('ciyex-messaging', Codicon.mail, localize('cMessaging', 'Messaging')),
	portalMgmt: registerIcon('ciyex-portal-mgmt', Codicon.shield, localize('cPortalMgmt', 'Portal Management')),
	clinical: registerIcon('ciyex-clinical', Codicon.beaker, localize('cClinical', 'Clinical')),
	operations: registerIcon('ciyex-operations', Codicon.briefcase, localize('cOperations', 'Operations')),
	reports: registerIcon('ciyex-reports', Codicon.graph, localize('cReports', 'Reports')),
	system: registerIcon('ciyex-system', Codicon.settingsGear, localize('cSystem', 'System')),
	hub: registerIcon('ciyex-hub', Codicon.library, localize('cHub', 'Ciyex Hub')),
	developer: registerIcon('ciyex-developer', Codicon.code, localize('cDeveloper', 'Developer Portal')),
};

// ─── Helper to register a ViewContainer + GenericListPane ────────────

function reg(id: string, title: string, icon: ReturnType<typeof registerIcon>, order: number): ViewContainer {
	return viewContainerRegistry.registerViewContainer({
		id,
		title: localize2(id, title),
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [id, {}]),
		icon,
		order,
	}, ViewContainerLocation.Sidebar);
}

// ─── All 13 sidebar ViewContainers (matching API menu items) ─────────
// Settings is in gear menu only, not sidebar

// Leaf items (no children - single GenericListPane each)
export const CALENDAR_CONTAINER = reg('ciyex.calendar', 'Calendar', icons.calendar, 1);
export const APPOINTMENTS_CONTAINER = reg('ciyex.appointments', 'Appointments', icons.appointments, 2);
export const PATIENTS_CONTAINER = reg('ciyex.patients', 'Patients', icons.patients, 3);
export const ENCOUNTERS_CONTAINER = reg('ciyex.encounters', 'Encounters', icons.encounters, 4);
export const TASKS_CONTAINER = reg('ciyex.tasks', 'Tasks', icons.tasks, 5);
export const MESSAGING_CONTAINER = reg('ciyex.messaging', 'Messaging', icons.messaging, 6);

// Parents (with children - multiple GenericListPanes)
export const PORTAL_MGMT_CONTAINER = reg('ciyex.portal-management', 'Portal Management', icons.portalMgmt, 7);
export const CLINICAL_CONTAINER = reg('ciyex.clinical', 'Clinical', icons.clinical, 8);
export const OPERATIONS_CONTAINER = reg('ciyex.operations', 'Operations', icons.operations, 9);
export const REPORTS_CONTAINER = reg('ciyex.reports', 'Reports', icons.reports, 10);
export const SYSTEM_CONTAINER = reg('ciyex.system', 'System', icons.system, 11);

// Hub and Developer
export const HUB_CONTAINER = reg('ciyex.hub', 'Ciyex Hub', icons.hub, 12);
export const DEVELOPER_CONTAINER = reg('ciyex.developer', 'Developer Portal', icons.developer, 13);

// ─── GenericListPane Configs ─────────────────────────────────────────

// Calendar
GenericListPane.configs.set('ciyex.calendar.view', {
	apiPath: `/api/appointments?date=${new Date().toISOString().split('T')[0]}`,
	columns: [{ key: 'patientName' }, { key: 'appointmentType' }, { key: 'status' }],
	avatarFields: ['patientFirstName', 'patientLastName'],
	emptyMessage: 'No appointments today',
});

// Appointments
GenericListPane.configs.set('ciyex.appointments.view', {
	apiPath: '/api/appointments?page=0&size=50',
	columns: [{ key: 'patientName' }, { key: 'appointmentType' }, { key: 'status' }],
	avatarFields: ['patientFirstName', 'patientLastName'],
	emptyMessage: 'No appointments',
});

// Encounters
GenericListPane.configs.set('ciyex.encounters.view', {
	apiPath: '/api/encounters',
	columns: [{ key: 'patientName' }, { key: 'type' }, { key: 'status' }],
	avatarFields: ['patientName', 'patientName'],
	onClickCommand: 'ciyex.openEncounter',
	onClickIdField: 'fhirId',
	onClickLabelField: 'patientName',
	emptyMessage: 'No encounters',
});

// Tasks
GenericListPane.configs.set('ciyex.tasks.view', {
	apiPath: '/api/tasks',
	columns: [{ key: 'title' }, { key: 'status' }],
	iconId: 'tasklist',
	emptyMessage: 'No tasks',
});

// Messaging
GenericListPane.configs.set('ciyex.messaging.view', {
	apiPath: '/api/messages',
	columns: [{ key: 'subject' }, { key: 'from' }],
	iconId: 'mail',
	emptyMessage: 'No messages',
});

// Portal Management > Document Reviews
GenericListPane.configs.set('ciyex.portal.docreviews', {
	apiPath: '/api/document-reviews',
	columns: [{ key: 'patientName' }, { key: 'documentType' }, { key: 'status' }],
	iconId: 'file',
	emptyMessage: 'No document reviews',
});

// Clinical children
GenericListPane.configs.set('ciyex.clinical.prescriptions', {
	apiPath: '/api/prescriptions', columns: [{ key: 'patientName' }, { key: 'medicationName' }, { key: 'status' }], iconId: 'beaker', emptyMessage: 'No prescriptions',
});
GenericListPane.configs.set('ciyex.clinical.labs', {
	apiPath: '/api/labs', columns: [{ key: 'patientName' }, { key: 'testName' }, { key: 'status' }], iconId: 'beaker', emptyMessage: 'No lab orders',
});
GenericListPane.configs.set('ciyex.clinical.immunizations', {
	apiPath: '/api/immunizations', columns: [{ key: 'patientName' }, { key: 'vaccineName' }, { key: 'status' }], iconId: 'shield', emptyMessage: 'No immunizations',
});
GenericListPane.configs.set('ciyex.clinical.referrals', {
	apiPath: '/api/referrals', columns: [{ key: 'patientName' }, { key: 'specialistName' }, { key: 'status' }], iconId: 'arrow-right', emptyMessage: 'No referrals',
});
GenericListPane.configs.set('ciyex.clinical.authorizations', {
	apiPath: '/api/authorizations', columns: [{ key: 'patientName' }, { key: 'type' }, { key: 'status' }], iconId: 'shield', emptyMessage: 'No authorizations',
});
GenericListPane.configs.set('ciyex.clinical.careplans', {
	apiPath: '/api/care-plans', columns: [{ key: 'patientName' }, { key: 'title' }, { key: 'status' }], iconId: 'heart', emptyMessage: 'No care plans',
});
GenericListPane.configs.set('ciyex.clinical.education', {
	apiPath: '/api/education', columns: [{ key: 'title' }, { key: 'category' }], iconId: 'book', emptyMessage: 'No education materials',
});

// Operations children
GenericListPane.configs.set('ciyex.operations.recall', {
	apiPath: '/api/recall', columns: [{ key: 'patientName' }, { key: 'reason' }, { key: 'status' }], iconId: 'bell', emptyMessage: 'No recall items',
});
GenericListPane.configs.set('ciyex.operations.codes', {
	apiPath: '/api/codes', columns: [{ key: 'code' }, { key: 'description' }], iconId: 'file', emptyMessage: 'No codes',
});
GenericListPane.configs.set('ciyex.operations.inventory', {
	apiPath: '/api/inventory', columns: [{ key: 'name' }, { key: 'quantity' }, { key: 'status' }], iconId: 'package', emptyMessage: 'No inventory items',
});
GenericListPane.configs.set('ciyex.operations.payments', {
	apiPath: '/api/payments', columns: [{ key: 'patientName' }, { key: 'amount' }, { key: 'status' }], iconId: 'credit-card', emptyMessage: 'No payments',
});
GenericListPane.configs.set('ciyex.operations.claims', {
	apiPath: '/api/claims', columns: [{ key: 'patientName' }, { key: 'payerName' }, { key: 'status' }], iconId: 'file', emptyMessage: 'No claims',
});

// Reports
GenericListPane.configs.set('ciyex.reports.view', {
	apiPath: '/api/reports', columns: [{ key: 'name' }, { key: 'type' }], iconId: 'graph', emptyMessage: 'No reports',
});

// System children
GenericListPane.configs.set('ciyex.system.alerts', {
	apiPath: '/api/cds-alerts', columns: [{ key: 'patientName' }, { key: 'alertType' }, { key: 'severity' }], iconId: 'warning', emptyMessage: 'No clinical alerts',
});
GenericListPane.configs.set('ciyex.system.consents', {
	apiPath: '/api/consents', columns: [{ key: 'patientName' }, { key: 'type' }, { key: 'status' }], iconId: 'file', emptyMessage: 'No consents',
});
GenericListPane.configs.set('ciyex.system.notifications', {
	apiPath: '/api/notifications', columns: [{ key: 'title' }, { key: 'type' }], iconId: 'bell', emptyMessage: 'No notifications',
});
GenericListPane.configs.set('ciyex.system.fax', {
	apiPath: '/api/fax', columns: [{ key: 'to' }, { key: 'subject' }, { key: 'status' }], iconId: 'mail', emptyMessage: 'No faxes',
});
GenericListPane.configs.set('ciyex.system.docscanning', {
	apiPath: '/api/documents', columns: [{ key: 'patientName' }, { key: 'documentType' }, { key: 'status' }], iconId: 'file', emptyMessage: 'No scanned documents',
});
GenericListPane.configs.set('ciyex.system.kiosk', {
	apiPath: '/api/kiosk', columns: [{ key: 'patientName' }, { key: 'status' }], iconId: 'device-mobile', emptyMessage: 'No kiosk check-ins',
});
GenericListPane.configs.set('ciyex.system.auditlog', {
	apiPath: '/api/admin/audit-log', columns: [{ key: 'user' }, { key: 'action' }, { key: 'timestamp' }], iconId: 'list-ordered', emptyMessage: 'No audit entries',
});

// ─── Views ──────────────────────────────────────────────────────────────

// Leaf containers - single view each
viewsRegistry.registerViews([{ id: 'ciyex.calendar.view', name: localize2('todayAppts', "Today's Appointments"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], CALENDAR_CONTAINER);
viewsRegistry.registerViews([{ id: 'ciyex.appointments.view', name: localize2('allAppts', "All Appointments"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], APPOINTMENTS_CONTAINER);
viewsRegistry.registerViews([{ id: PatientListPane.ID, name: localize2('patientList', "Patient List"), ctorDescriptor: new SyncDescriptor(PatientListPane) }], PATIENTS_CONTAINER);
viewsRegistry.registerViews([{ id: 'ciyex.encounters.view', name: localize2('encounters', "Encounters"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], ENCOUNTERS_CONTAINER);
viewsRegistry.registerViews([{ id: 'ciyex.tasks.view', name: localize2('tasks', "Tasks"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], TASKS_CONTAINER);
viewsRegistry.registerViews([{ id: 'ciyex.messaging.view', name: localize2('inbox', "Inbox"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], MESSAGING_CONTAINER);

// Portal Management
viewsRegistry.registerViews([{ id: 'ciyex.portal.docreviews', name: localize2('docReviews', "Document Reviews"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], PORTAL_MGMT_CONTAINER);

// Clinical - multiple views
viewsRegistry.registerViews([
	{ id: 'ciyex.clinical.prescriptions', name: localize2('prescriptions', "Prescriptions"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.labs', name: localize2('labs', "Labs"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.immunizations', name: localize2('immunizations', "Immunizations"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.referrals', name: localize2('referrals', "Referrals"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.authorizations', name: localize2('authorizations', "Authorizations"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.careplans', name: localize2('carePlans', "Care Plans"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.clinical.education', name: localize2('education', "Education"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
], CLINICAL_CONTAINER);

// Operations - multiple views
viewsRegistry.registerViews([
	{ id: 'ciyex.operations.recall', name: localize2('recall', "Recall"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.operations.codes', name: localize2('codes', "Codes"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.operations.inventory', name: localize2('inventory', "Inventory"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.operations.payments', name: localize2('payments', "Payments"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.operations.claims', name: localize2('claims', "Claims"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
], OPERATIONS_CONTAINER);

// Reports
viewsRegistry.registerViews([{ id: 'ciyex.reports.view', name: localize2('dashboard', "Dashboard"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], REPORTS_CONTAINER);

// System - multiple views
viewsRegistry.registerViews([
	{ id: 'ciyex.system.alerts', name: localize2('clinicalAlerts', "Clinical Alerts"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.system.consents', name: localize2('consents', "Consents"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.system.notifications', name: localize2('notifications', "Notifications"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.system.fax', name: localize2('fax', "Fax"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.system.docscanning', name: localize2('docScanning', "Doc Scanning"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.system.kiosk', name: localize2('kiosk', "Check-in Kiosk"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
	{ id: 'ciyex.system.auditlog', name: localize2('auditLog', "Audit Log"), ctorDescriptor: new SyncDescriptor(GenericListPane) },
], SYSTEM_CONTAINER);

// Hub and Developer - placeholder views
viewsRegistry.registerViews([{ id: 'ciyex.hub.view', name: localize2('hubBrowse', "Browse Apps"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], HUB_CONTAINER);
viewsRegistry.registerViews([{ id: 'ciyex.developer.view', name: localize2('devPortal', "API & Webhooks"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], DEVELOPER_CONTAINER);
