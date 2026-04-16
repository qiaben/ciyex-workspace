/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorExtensions } from '../../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { localize } from '../../../../../nls.js';
import { LayoutEditorInput, EncounterEditorInput, FieldConfigEditorInput, MenuEditorInput, ColorsEditorInput, RolesEditorInput, CalendarEditorInput, PatientChartEditorInput, EncounterFormEditorInput, MessagingEditorInput, PortalSettingsEditorInput, UserManagementEditorInput, RolesEditorInput2, TasksEditorInput, PrescriptionsEditorInput, ImmunizationsEditorInput, ReferralsEditorInput, CarePlansEditorInput, CdsEditorInput, AuthorizationsEditorInput, ReportsEditorInput, AppointmentsEditorInput } from './ciyexEditorInput.js';
import { LayoutEditor } from './layoutEditor.js';
import { EncounterEditor } from './encounterEditor.js';
import { FieldConfigEditor } from './fieldConfigEditor.js';
import { MenuEditor } from './menuEditor.js';
import { ColorsEditor } from './colorsEditor.js';
import { RolesEditor } from './rolesEditor.js';
import { CalendarEditor } from './calendarEditor.js';
import { PatientChartEditor } from './patientChartEditor.js';
import { EncounterFormEditor } from './encounterFormEditor.js';
import { MessagingEditor } from './messagingEditor.js';
import { PortalSettingsEditor } from './portalSettingsEditor.js';
import { UserManagementEditor } from './userManagementEditor.js';
import { RolesPermissionsEditor } from './rolesPermissionsEditor.js';
import { TasksEditor } from './tasksEditor.js';
import { PrescriptionsEditor, ImmunizationsEditor, ReferralsEditor, CarePlansEditor, CdsEditor, AuthorizationsEditor } from './clinicalEditors.js';
import { ReportsEditor } from './reportsEditor.js';
import { AppointmentsEditor } from './appointmentsEditor.js';

const reg = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane);

reg.registerEditorPane(EditorPaneDescriptor.create(LayoutEditor, LayoutEditor.ID, localize('layout', "Chart Layout")), [new SyncDescriptor(LayoutEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(EncounterEditor, EncounterEditor.ID, localize('encounter', "Encounter Form")), [new SyncDescriptor(EncounterEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(FieldConfigEditor, FieldConfigEditor.ID, localize('fieldConfig', "Field Configuration")), [new SyncDescriptor(FieldConfigEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(MenuEditor, MenuEditor.ID, localize('menu', "Menu Configuration")), [new SyncDescriptor(MenuEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(ColorsEditor, ColorsEditor.ID, localize('colors', "Calendar Colors")), [new SyncDescriptor(ColorsEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(RolesEditor, RolesEditor.ID, localize('roles', "Roles & Permissions")), [new SyncDescriptor(RolesEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(CalendarEditor, CalendarEditor.ID, localize('calendar', "Calendar")), [new SyncDescriptor(CalendarEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(PatientChartEditor, PatientChartEditor.ID, localize('patientChart', "Patient Chart")), [new SyncDescriptor(PatientChartEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(EncounterFormEditor, EncounterFormEditor.ID, localize('encounterForm', "Encounter")), [new SyncDescriptor(EncounterFormEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(MessagingEditor, MessagingEditor.ID, localize('messaging', "Messages")), [new SyncDescriptor(MessagingEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(PortalSettingsEditor, PortalSettingsEditor.ID, localize('portalSettings', "Portal Settings")), [new SyncDescriptor(PortalSettingsEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(UserManagementEditor, UserManagementEditor.ID, localize('userMgmt', "User Management")), [new SyncDescriptor(UserManagementEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(RolesPermissionsEditor, RolesPermissionsEditor.ID, localize('rolesPerms', "Roles & Permissions")), [new SyncDescriptor(RolesEditorInput2)]);
reg.registerEditorPane(EditorPaneDescriptor.create(TasksEditor, TasksEditor.ID, localize('tasks', "Tasks")), [new SyncDescriptor(TasksEditorInput)]);

// Clinical editors
reg.registerEditorPane(EditorPaneDescriptor.create(PrescriptionsEditor, PrescriptionsEditor.ID, localize('prescriptions', "Prescriptions")), [new SyncDescriptor(PrescriptionsEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(ImmunizationsEditor, ImmunizationsEditor.ID, localize('immunizations', "Immunizations")), [new SyncDescriptor(ImmunizationsEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(ReferralsEditor, ReferralsEditor.ID, localize('referrals', "Referrals")), [new SyncDescriptor(ReferralsEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(CarePlansEditor, CarePlansEditor.ID, localize('carePlans', "Care Plans")), [new SyncDescriptor(CarePlansEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(CdsEditor, CdsEditor.ID, localize('cds', "Clinical Decision Support")), [new SyncDescriptor(CdsEditorInput)]);
reg.registerEditorPane(EditorPaneDescriptor.create(AuthorizationsEditor, AuthorizationsEditor.ID, localize('authorizations', "Prior Authorizations")), [new SyncDescriptor(AuthorizationsEditorInput)]);

// Reports
reg.registerEditorPane(EditorPaneDescriptor.create(ReportsEditor, ReportsEditor.ID, localize('report', "Report")), [new SyncDescriptor(ReportsEditorInput)]);

// Appointments
reg.registerEditorPane(EditorPaneDescriptor.create(AppointmentsEditor, AppointmentsEditor.ID, localize('appointments', "Appointments")), [new SyncDescriptor(AppointmentsEditorInput)]);
