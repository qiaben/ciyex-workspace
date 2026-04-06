/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorExtensions } from '../../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { localize } from '../../../../../nls.js';
import { CiyexConfigEditorInput } from './ciyexEditorInput.js';
import { LayoutEditor } from './layoutEditor.js';
import { EncounterEditor } from './encounterEditor.js';
import { FieldConfigEditor } from './fieldConfigEditor.js';
import { MenuEditor } from './menuEditor.js';
import { ColorsEditor } from './colorsEditor.js';
import { RolesEditor } from './rolesEditor.js';

const reg = Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane);
const sd = new SyncDescriptor(CiyexConfigEditorInput);

reg.registerEditorPane(EditorPaneDescriptor.create(LayoutEditor, LayoutEditor.ID, localize('layoutEditor', "Chart Layout")), [sd]);
reg.registerEditorPane(EditorPaneDescriptor.create(EncounterEditor, EncounterEditor.ID, localize('encounterEditor', "Encounter Form")), [sd]);
reg.registerEditorPane(EditorPaneDescriptor.create(FieldConfigEditor, FieldConfigEditor.ID, localize('fieldConfigEditor', "Field Configuration")), [sd]);
reg.registerEditorPane(EditorPaneDescriptor.create(MenuEditor, MenuEditor.ID, localize('menuEditor', "Menu Configuration")), [sd]);
reg.registerEditorPane(EditorPaneDescriptor.create(ColorsEditor, ColorsEditor.ID, localize('colorsEditor', "Calendar Colors")), [sd]);
reg.registerEditorPane(EditorPaneDescriptor.create(RolesEditor, RolesEditor.ID, localize('rolesEditor', "Roles & Permissions")), [sd]);
