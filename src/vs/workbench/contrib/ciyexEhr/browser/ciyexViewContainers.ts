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
import { ScheduleSidebarPane } from './scheduleSidebarPane.js';

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

// allow-any-unicode-next-line
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
	system: registerIcon('ciyex-system', Codicon.tools, localize('cSystem', 'System')),
	developer: registerIcon('ciyex-developer', Codicon.code, localize('cDeveloper', 'Developer Portal')),
};

// allow-any-unicode-next-line
// ─── Helper to register a ViewContainer + GenericListPane ────────────

function reg(id: string, title: ReturnType<typeof localize2>, icon: ReturnType<typeof registerIcon>, order: number): ViewContainer {
	return viewContainerRegistry.registerViewContainer({
		id,
		title,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [id, {}]),
		icon,
		order,
	}, ViewContainerLocation.Sidebar);
}

// allow-any-unicode-next-line
// ─── All 12 sidebar ViewContainers (matching API menu items) ─────────
// Settings is in gear menu only, not sidebar

// Leaf items (no children - single GenericListPane each)
export const CALENDAR_CONTAINER = reg('ciyex.calendar', localize2('ciyex.calendar', "Calendar"), icons.calendar, 1);
export const APPOINTMENTS_CONTAINER = reg('ciyex.appointments', localize2('ciyex.appointments', "Appointments"), icons.appointments, 2);
export const PATIENTS_CONTAINER = reg('ciyex.patients', localize2('ciyex.patients', "Patients"), icons.patients, 3);
export const ENCOUNTERS_CONTAINER = reg('ciyex.encounters', localize2('ciyex.encounters', "Encounters"), icons.encounters, 4);
export const TASKS_CONTAINER = reg('ciyex.tasks', localize2('ciyex.tasks', "Tasks"), icons.tasks, 5);
export const MESSAGING_CONTAINER = reg('ciyex.messaging', localize2('ciyex.messaging', "Messaging"), icons.messaging, 6);

// Parents (with children - multiple GenericListPanes)
export const PORTAL_MGMT_CONTAINER = reg('ciyex.portal-management', localize2('ciyex.portal-management', "Portal Management"), icons.portalMgmt, 7);
export const CLINICAL_CONTAINER = reg('ciyex.clinical', localize2('ciyex.clinical', "Clinical"), icons.clinical, 8);
export const OPERATIONS_CONTAINER = reg('ciyex.operations', localize2('ciyex.operations', "Operations"), icons.operations, 9);
export const REPORTS_CONTAINER = reg('ciyex.reports', localize2('ciyex.reports', "Reports"), icons.reports, 10);
export const SYSTEM_CONTAINER = reg('ciyex.system', localize2('ciyex.system', "System"), icons.system, 11);

// Settings — removed separate sidebar, items are in VS Code Settings (Cmd+,) and System menu
// The SettingsListPane items (User Mgmt, Roles, Portal, etc.) are accessible via top menu System → Settings

// Developer
export const DEVELOPER_CONTAINER = reg('ciyex.developer', localize2('ciyex.developer', "Developer Portal"), icons.developer, 12);

// allow-any-unicode-next-line
// ─── GenericListPane Configs ─────────────────────────────────────────

// Calendar
GenericListPane.configs.set('ciyex.calendar.view', {
	apiPath: `/api/appointments?date=${new Date().toISOString().split('T')[0]}`,
	columns: [{ key: 'patientName' }, { key: 'appointmentType' }, { key: 'status' }],
	avatarFields: ['patientFirstName', 'patientLastName'],
	emptyMessage: 'No appointments today',
});

// Appointments — FHIR endpoint (the /api/appointments endpoint returns empty/hangs)
// Column keys use "|" fallbacks because FHIR returns patientDisplay/providerDisplay, not patientName
GenericListPane.configs.set('ciyex.appointments.view', {
	apiPath: '/api/fhir-resource/appointments?page=0&size=200',
	columns: [
		{ key: 'patientName|patientDisplay' },
		{ key: 'appointmentType|type|serviceType' },
		{ key: 'status' },
	],
	avatarFields: ['patientFirstName|patientDisplay', 'patientLastName|patientDisplay'],
	emptyMessage: 'No appointments',
});

// Encounters — FHIR endpoint (faster than /api/encounters which hangs)
// Type codes mapped: AMB=Ambulatory, HH=Home Health, EMER=Emergency, SS=Short Stay, VR=Virtual, OBSENC=Observation
GenericListPane.configs.set('ciyex.encounters.view', {
	apiPath: '/api/fhir-resource/encounters?page=0&size=200',
	columns: [
		{ key: 'providerDisplay', label: 'Provider' },
		{ key: 'type', label: 'Type' },
		{ key: 'status', label: 'Status' },
	],
	avatarFields: ['providerDisplay', 'providerDisplay'],
	onClickCommand: 'ciyex.openEncounter',
	onClickIdField: 'fhirId',
	onClickLabelField: 'providerDisplay',
	emptyMessage: 'No encounters',
	labelMap: { 'AMB': 'Ambulatory', 'HH': 'Home Health', 'EMER': 'Emergency', 'SS': 'Short Stay', 'VR': 'Virtual', 'OBSENC': 'Observation' },
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

// Clinical children — FHIR resource endpoints
GenericListPane.configs.set('ciyex.clinical.prescriptions', {
	apiPath: '/api/fhir-resource/medications', columns: [{ key: 'patientRefDisplay' }, { key: 'medicationDisplay' }, { key: 'status' }], iconId: 'beaker', emptyMessage: 'No prescriptions',
});
GenericListPane.configs.set('ciyex.clinical.labs', {
	apiPath: '/api/fhir-resource/lab-orders', columns: [{ key: 'patientRefDisplay' }, { key: 'testName' }, { key: 'status' }], iconId: 'beaker', emptyMessage: 'No lab orders',
});
GenericListPane.configs.set('ciyex.clinical.immunizations', {
	apiPath: '/api/fhir-resource/immunizations', columns: [{ key: 'patientRefDisplay' }, { key: 'vaccineDisplay' }, { key: 'status' }], iconId: 'shield', emptyMessage: 'No immunizations',
});
GenericListPane.configs.set('ciyex.clinical.referrals', {
	apiPath: '/api/fhir-resource/referrals', columns: [{ key: 'patientRefDisplay' }, { key: 'specialistDisplay' }, { key: 'status' }], iconId: 'arrow-right', emptyMessage: 'No referrals',
});
GenericListPane.configs.set('ciyex.clinical.authorizations', {
	apiPath: '/api/fhir-resource/authorizations', columns: [{ key: 'patientRefDisplay' }, { key: 'type' }, { key: 'status' }], iconId: 'shield', emptyMessage: 'No authorizations',
});
GenericListPane.configs.set('ciyex.clinical.careplans', {
	apiPath: '/api/fhir-resource/care-plans', columns: [{ key: 'patientRefDisplay' }, { key: 'title' }, { key: 'status' }], iconId: 'heart', emptyMessage: 'No care plans',
});
GenericListPane.configs.set('ciyex.clinical.education', {
	apiPath: '/api/patient-education', columns: [{ key: 'title' }, { key: 'category' }], iconId: 'book', emptyMessage: 'No education materials',
});

// Operations children
GenericListPane.configs.set('ciyex.operations.recall', {
	apiPath: '/api/recall-campaigns', columns: [{ key: 'name' }, { key: 'patientCount' }, { key: 'status' }], iconId: 'bell', emptyMessage: 'No recall campaigns',
});
GenericListPane.configs.set('ciyex.operations.codes', {
	apiPath: '/api/fhir-resource/code-sets', columns: [{ key: 'code' }, { key: 'display' }, { key: 'system' }], iconId: 'file', emptyMessage: 'No codes',
});
GenericListPane.configs.set('ciyex.operations.inventory', {
	apiPath: '/api/fhir-resource/supplies', columns: [{ key: 'name' }, { key: 'quantity' }, { key: 'status' }], iconId: 'package', emptyMessage: 'No inventory items',
});
GenericListPane.configs.set('ciyex.operations.payments', {
	apiPath: '/api/fhir-resource/payments', columns: [{ key: 'patientRefDisplay' }, { key: 'amount' }, { key: 'status' }], iconId: 'credit-card', emptyMessage: 'No payments',
});
GenericListPane.configs.set('ciyex.operations.claims', {
	apiPath: '/api/fhir-resource/claims', columns: [{ key: 'patientRefDisplay' }, { key: 'payerDisplay' }, { key: 'status' }], iconId: 'file', emptyMessage: 'No claims',
});

// Reports — use prescriptions/stats as a working endpoint to show data
GenericListPane.configs.set('ciyex.reports.view', {
	apiPath: '/api/prescriptions/stats', columns: [{ key: 'active' }, { key: 'completed' }, { key: 'cancelled' }], iconId: 'graph', emptyMessage: 'No report data',
});

// System children
GenericListPane.configs.set('ciyex.system.alerts', {
	apiPath: '/api/cds-hooks/alerts', columns: [{ key: 'patientRefDisplay' }, { key: 'summary' }, { key: 'indicator' }], iconId: 'warning', emptyMessage: 'No clinical alerts',
});
GenericListPane.configs.set('ciyex.system.consents', {
	apiPath: '/api/fhir-resource/consents', columns: [{ key: 'patientRefDisplay' }, { key: 'category' }, { key: 'status' }], iconId: 'file', emptyMessage: 'No consents',
});
GenericListPane.configs.set('ciyex.system.notifications', {
	apiPath: '/api/portal/notifications/my', columns: [{ key: 'title' }, { key: 'type' }, { key: 'createdAt' }], iconId: 'bell', emptyMessage: 'No notifications',
});
GenericListPane.configs.set('ciyex.system.fax', {
	apiPath: '/api/fax/messages', columns: [{ key: 'to' }, { key: 'status' }, { key: 'createdAt' }], iconId: 'mail', emptyMessage: 'No faxes',
});
GenericListPane.configs.set('ciyex.system.docscanning', {
	apiPath: '/api/fhir-resource/documents', columns: [{ key: 'patientRefDisplay' }, { key: 'category' }, { key: 'status' }], iconId: 'file', emptyMessage: 'No scanned documents',
});
GenericListPane.configs.set('ciyex.system.kiosk', {
	apiPath: '/api/kiosk/check-ins', columns: [{ key: 'patientName' }, { key: 'status' }, { key: 'checkedInAt' }], iconId: 'device-mobile', emptyMessage: 'No kiosk check-ins',
});
GenericListPane.configs.set('ciyex.system.auditlog', {
	apiPath: '/api/admin/audit-log', columns: [{ key: 'user' }, { key: 'action' }, { key: 'timestamp' }], iconId: 'list-ordered', emptyMessage: 'No audit entries',
});

// allow-any-unicode-next-line
// ─── Views ──────────────────────────────────────────────────────────────

// Calendar - rich schedule sidebar (today's timeline + upcoming + stats)
viewsRegistry.registerViews([{ id: ScheduleSidebarPane.ID, name: localize2('schedule', "Schedule"), ctorDescriptor: new SyncDescriptor(ScheduleSidebarPane) }], CALENDAR_CONTAINER);
// Appointments flat list kept as secondary view
viewsRegistry.registerViews([{ id: 'ciyex.appointments.view', name: localize2('allAppts', "All Appointments"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], APPOINTMENTS_CONTAINER);
viewsRegistry.registerViews([{ id: PatientListPane.ID, name: localize2('patientList', "Patient List"), ctorDescriptor: new SyncDescriptor(PatientListPane) }], PATIENTS_CONTAINER);
import { EncounterListPane } from './encounterListPane.js';
viewsRegistry.registerViews([{ id: EncounterListPane.ID, name: localize2('encounters', "Encounters"), ctorDescriptor: new SyncDescriptor(EncounterListPane) }], ENCOUNTERS_CONTAINER);
viewsRegistry.registerViews([{ id: 'ciyex.tasks.view', name: localize2('tasks', "Tasks"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], TASKS_CONTAINER);
import { ChannelListPane } from './messaging/channelListPane.js';
viewsRegistry.registerViews([{ id: ChannelListPane.ID, name: localize2('channels', "Channels"), ctorDescriptor: new SyncDescriptor(ChannelListPane) }], MESSAGING_CONTAINER);

// Portal Management — dedicated panes replacing GenericListPane
import { DocumentReviewPane } from './portal/documentReviewPane.js';
import { AccessRequestPane } from './portal/accessRequestPane.js';
import { FormSubmissionPane } from './portal/formSubmissionPane.js';
import { PortalFormsPane } from './portal/portalFormsPane.js';
import { TemplatesPane } from './portal/templatesPane.js';
viewsRegistry.registerViews([
	{ id: DocumentReviewPane.ID, name: localize2('docReviews', "Document Reviews"), ctorDescriptor: new SyncDescriptor(DocumentReviewPane) },
	{ id: AccessRequestPane.ID, name: localize2('accessRequests', "Access Requests"), ctorDescriptor: new SyncDescriptor(AccessRequestPane) },
	{ id: FormSubmissionPane.ID, name: localize2('formSubmissions', "Form Submissions"), ctorDescriptor: new SyncDescriptor(FormSubmissionPane) },
	{ id: PortalFormsPane.ID, name: localize2('portalForms', "Portal Forms"), ctorDescriptor: new SyncDescriptor(PortalFormsPane) },
	{ id: TemplatesPane.ID, name: localize2('templates', "Templates"), ctorDescriptor: new SyncDescriptor(TemplatesPane) },
], PORTAL_MGMT_CONTAINER);

// Clinical — clickable menu pane that opens EditorPanes
import { ClinicalMenuPane } from './portal/clinicalMenuPane.js';
viewsRegistry.registerViews([
	{ id: ClinicalMenuPane.ID, name: localize2('clinicalMenu', "Clinical"), ctorDescriptor: new SyncDescriptor(ClinicalMenuPane) },
], CLINICAL_CONTAINER);

// Operations — clickable menu pane
import { OperationsMenuPane } from './portal/operationsMenuPane.js';
viewsRegistry.registerViews([
	{ id: OperationsMenuPane.ID, name: localize2('operationsMenu', "Operations"), ctorDescriptor: new SyncDescriptor(OperationsMenuPane) },
], OPERATIONS_CONTAINER);

// Reports — clickable report list with categories
import { ReportsPane } from './portal/reportsPane.js';
viewsRegistry.registerViews([{ id: ReportsPane.ID, name: localize2('reports', "Reports"), ctorDescriptor: new SyncDescriptor(ReportsPane) }], REPORTS_CONTAINER);

// System — clickable menu pane
import { SystemMenuPane } from './portal/systemMenuPane.js';
viewsRegistry.registerViews([
	{ id: SystemMenuPane.ID, name: localize2('systemMenu', "System"), ctorDescriptor: new SyncDescriptor(SystemMenuPane) },
], SYSTEM_CONTAINER);

// Developer - placeholder view
viewsRegistry.registerViews([{ id: 'ciyex.developer.view', name: localize2('devPortal', "API & Webhooks"), ctorDescriptor: new SyncDescriptor(GenericListPane) }], DEVELOPER_CONTAINER);

