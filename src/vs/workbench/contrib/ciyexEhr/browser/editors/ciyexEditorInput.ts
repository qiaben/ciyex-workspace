/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../../common/editor/editorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';

/**
 * EditorInput for .ciyex config files opened in visual editor mode.
 * Each config type (layout, encounter, fields, etc.) uses this input
 * with a different configType and fileUri.
 */
export class CiyexConfigEditorInput extends EditorInput {

	static readonly ID = 'workbench.input.ciyexConfig';

	constructor(
		readonly configType: string,
		readonly fileUri: URI,
		readonly configLabel: string,
		private readonly _icon: ThemeIcon,
		readonly preferredEditorId?: string,
	) {
		super();
	}

	override get typeId(): string {
		return CiyexConfigEditorInput.ID;
	}

	override get editorId(): string | undefined {
		return this.preferredEditorId;
	}

	override getName(): string {
		return this.configLabel;
	}

	override getIcon(): ThemeIcon | undefined {
		return this._icon;
	}

	get resource(): URI {
		return this.fileUri;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		if (other instanceof CiyexConfigEditorInput) {
			return this.configType === other.configType && this.fileUri.toString() === other.fileUri.toString();
		}
		return false;
	}
}
