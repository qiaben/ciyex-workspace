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

// Register Layout Editor
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		LayoutEditor,
		LayoutEditor.ID,
		localize('layoutEditor', "Chart Layout Editor")
	),
	[new SyncDescriptor(CiyexConfigEditorInput)]
);
