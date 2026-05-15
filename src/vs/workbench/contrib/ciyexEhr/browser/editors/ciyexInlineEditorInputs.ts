/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IEnvironmentService } from '../../../../../platform/environment/common/environment.js';
import { URI } from '../../../../../base/common/uri.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import {
	SettingsHubEditorInput,
	LayoutHubEditorInput,
	PracticeSettingsEditorInput,
	LayoutSettingsEditorInput,
	PortalSettingsEditorInput,
	EncounterEditorInput,
	MenuEditorInput,
	LayoutEditorInput,
	FieldConfigEditorInput,
} from './ciyexEditorInput.js';

// Build the EditorInput a CIYEX CONFIG command would normally open. Used both
// by SettingsEditor2 (to embed the editor inside the User Settings page) and
// by hub editors (e.g. LayoutHubEditor) that host nested editors in their own
// content area. Returns undefined for unknown commands.
export function createCiyexInlineEditorInput(
	commandId: string,
	instantiationService: IInstantiationService,
	environmentService: IEnvironmentService
): EditorInput | undefined {
	const ciyexUri = (path: string): URI =>
		URI.joinPath(environmentService.userRoamingDataHome, '.ciyex', path);

	switch (commandId) {
		case 'ciyex.openSettingsHub':
			return instantiationService.createInstance(SettingsHubEditorInput, '');
		case 'ciyex.openTemplateDocuments':
			return instantiationService.createInstance(SettingsHubEditorInput, '__template-documents__');
		case 'ciyex.openLayoutHub':
			return instantiationService.createInstance(LayoutHubEditorInput);
		case 'ciyex.openPracticeSettings':
			return instantiationService.createInstance(PracticeSettingsEditorInput);
		case 'ciyex.openLayoutSettings':
			return instantiationService.createInstance(LayoutSettingsEditorInput);
		case 'ciyex.openPortalSettings':
			return instantiationService.createInstance(PortalSettingsEditorInput);
		case 'ciyex.openEncounterConfig':
			return instantiationService.createInstance(
				EncounterEditorInput, 'encounter', ciyexUri('encounter.json'),
				'Encounter Form', ThemeIcon.fromId('notebook')
			);
		case 'ciyex.openMenuConfig':
			return instantiationService.createInstance(
				MenuEditorInput, 'menu', ciyexUri('menu.json'),
				'Menu Configuration', ThemeIcon.fromId('list-tree')
			);
		case 'ciyex.openChartLayout':
			return instantiationService.createInstance(
				LayoutEditorInput, 'layout', ciyexUri('chart-layout.json'),
				'Chart Layout', ThemeIcon.fromId('layout')
			);
		case 'ciyex.openFieldConfig':
			return instantiationService.createInstance(
				FieldConfigEditorInput, 'fields/demographics',
				ciyexUri('fields/demographics.json'),
				'Fields: demographics', ThemeIcon.fromId('symbol-field')
			);
		default:
			return undefined;
	}
}
