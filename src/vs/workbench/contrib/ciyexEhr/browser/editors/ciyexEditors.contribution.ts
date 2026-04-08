/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorExtensions } from '../../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { localize } from '../../../../../nls.js';
import { LayoutEditorInput, EncounterEditorInput, FieldConfigEditorInput, MenuEditorInput, ColorsEditorInput, RolesEditorInput, CalendarEditorInput, PatientChartEditorInput, EncounterFormEditorInput } from './ciyexEditorInput.js';
import { LayoutEditor } from './layoutEditor.js';
import { EncounterEditor } from './encounterEditor.js';
import { FieldConfigEditor } from './fieldConfigEditor.js';
import { MenuEditor } from './menuEditor.js';
import { ColorsEditor } from './colorsEditor.js';
import { RolesEditor } from './rolesEditor.js';
import { CalendarEditor } from './calendarEditor.js';
import { PatientChartEditor } from './patientChartEditor.js';
import { EncounterFormEditor } from './encounterFormEditor.js';

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
