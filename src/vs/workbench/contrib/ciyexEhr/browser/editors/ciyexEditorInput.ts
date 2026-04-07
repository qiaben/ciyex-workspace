/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../../common/editor/editorInput.js';
import { URI } from '../../../../../base/common/uri.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';

export abstract class BaseCiyexInput extends EditorInput {
	constructor(
		readonly configType: string,
		readonly fileUri: URI,
		readonly configLabel: string,
		private readonly _icon: ThemeIcon,
	) { super(); }

	override getName(): string { return this.configLabel; }
	override getIcon(): ThemeIcon | undefined { return this._icon; }
	get resource(): URI { return this.fileUri; }

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof BaseCiyexInput && other.constructor === this.constructor && this.fileUri.toString() === other.fileUri.toString();
	}
}

export class LayoutEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexLayout';
	override get typeId(): string { return LayoutEditorInput.ID; }
}

export class EncounterEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexEncounter';
	override get typeId(): string { return EncounterEditorInput.ID; }
}

export class FieldConfigEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexFieldConfig';
	override get typeId(): string { return FieldConfigEditorInput.ID; }
}

export class MenuEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexMenu';
	override get typeId(): string { return MenuEditorInput.ID; }
}

export class ColorsEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexColors';
	override get typeId(): string { return ColorsEditorInput.ID; }
}

export class RolesEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexRoles';
	override get typeId(): string { return RolesEditorInput.ID; }
}

export class PortalEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexPortal';
	override get typeId(): string { return PortalEditorInput.ID; }
}

// Keep backward compat alias
export const CiyexConfigEditorInput = LayoutEditorInput;
