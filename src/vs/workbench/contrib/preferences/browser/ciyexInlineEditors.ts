/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The canonical implementation lives in the ciyexEhr contrib so hub editors
// (e.g. LayoutHubEditor) can use it without a circular import. This module
// re-exports it for SettingsEditor2.
export { createCiyexInlineEditorInput } from '../../ciyexEhr/browser/editors/ciyexInlineEditorInputs.js';
