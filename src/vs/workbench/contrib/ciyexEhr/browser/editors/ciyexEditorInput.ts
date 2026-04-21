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

export class CalendarEditorInput extends BaseCiyexInput {
	static readonly ID = 'workbench.input.ciyexCalendar';
	override get typeId(): string { return CalendarEditorInput.ID; }
}

// allow-any-unicode-next-line
// ─── Clinical EditorInputs (patient-scoped, not file-based) ───

export class PatientChartEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexPatientChart';
	override get typeId(): string { return PatientChartEditorInput.ID; }

	constructor(
		readonly patientId: string,
		readonly patientName: string,
	) { super(); }

	override getName(): string { return this.patientName || 'Patient Chart'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('person'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-patient', path: `/${this.patientId}` }); }

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof PatientChartEditorInput && this.patientId === other.patientId;
	}
}

export class EncounterFormEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexEncounterForm';
	override get typeId(): string { return EncounterFormEditorInput.ID; }

	constructor(
		readonly patientId: string,
		readonly encounterId: string,
		readonly patientName: string,
		readonly encounterLabel: string,
	) { super(); }

	override getName(): string { return this.encounterLabel || 'Encounter'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('notebook'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-encounter', path: `/encounter/${this.patientId || '_'}/${this.encounterId}` }); }

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof EncounterFormEditorInput && this.patientId === other.patientId && this.encounterId === other.encounterId;
	}
}

// allow-any-unicode-next-line
// ─── Messaging EditorInput (channel-scoped) ───

export class MessagingEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexMessaging';
	override get typeId(): string { return MessagingEditorInput.ID; }

	constructor(
		readonly channelId: string,
		readonly channelName: string,
		readonly channelType: 'public' | 'private' | 'dm' | 'group_dm',
		readonly threadParentId?: string,
	) { super(); }

	override getName(): string {
		if (this.threadParentId) { return `Thread`; }
		return this.channelType === 'dm' || this.channelType === 'group_dm'
			? this.channelName || 'Direct Message'
			: `#${this.channelName || 'channel'}`;
	}

	override getIcon(): ThemeIcon | undefined {
		if (this.threadParentId) { return ThemeIcon.fromId('git-pull-request'); }
		return this.channelType === 'dm' ? ThemeIcon.fromId('account') : ThemeIcon.fromId('comment-discussion');
	}

	get resource(): URI {
		const path = this.threadParentId
			? `/messaging/${this.channelId}/thread/${this.threadParentId}`
			: `/messaging/${this.channelId}`;
		return URI.from({ scheme: 'ciyex-messaging', path });
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof MessagingEditorInput
			&& this.channelId === other.channelId
			&& this.threadParentId === other.threadParentId;
	}
}

// allow-any-unicode-next-line
// ─── Portal Management EditorInput ───

export class PortalSettingsEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexPortalSettings';
	override get typeId(): string { return PortalSettingsEditorInput.ID; }

	constructor() { super(); }

	override getName(): string { return 'Portal Settings'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('globe'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-portal', path: '/settings' }); }

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof PortalSettingsEditorInput;
	}
}

// allow-any-unicode-next-line
// ─── Settings EditorInputs (singleton, no params) ───

export class UserManagementEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexUserMgmt';
	override get typeId(): string { return UserManagementEditorInput.ID; }
	constructor() { super(); }
	override getName(): string { return 'User Management'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('people'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-settings', path: '/user-management' }); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof UserManagementEditorInput; }
}

export class RolesEditorInput2 extends EditorInput {
	static readonly ID = 'workbench.input.ciyexRolesPerms';
	override get typeId(): string { return RolesEditorInput2.ID; }
	constructor() { super(); }
	override getName(): string { return 'Roles & Permissions'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('shield'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-settings', path: '/roles-permissions' }); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof RolesEditorInput2; }
}

export class TasksEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexTasks';
	override get typeId(): string { return TasksEditorInput.ID; }
	constructor() { super(); }
	override getName(): string { return 'Tasks'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('tasklist'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-settings', path: '/tasks' }); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof TasksEditorInput; }
}

// allow-any-unicode-next-line
// ─── Reports EditorInput ───

export class ReportsEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexReport';
	override get typeId(): string { return ReportsEditorInput.ID; }

	constructor(
		readonly reportKey: string,
		readonly reportLabel: string,
		readonly category: string,
	) { super(); }

	override getName(): string { return this.reportLabel; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('graph'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-report', path: `/${this.category}/${this.reportKey}` }); }

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof ReportsEditorInput && this.reportKey === other.reportKey;
	}
}

// allow-any-unicode-next-line
// ─── Clinical EditorInputs ───

abstract class BaseClinicalEditorInput extends EditorInput {
	abstract readonly clinicalId: string;
	abstract readonly clinicalLabel: string;
	abstract readonly clinicalIcon: string;

	override get typeId(): string { return this.clinicalId; }
	override getName(): string { return this.clinicalLabel; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId(this.clinicalIcon); }
	get resource(): URI {
		return URI.from({ scheme: 'ciyex-clinical', path: `/${this.clinicalLabel.toLowerCase().replace(/\s+/g, '-')}` });
	}
	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return other instanceof BaseClinicalEditorInput && other.constructor === this.constructor;
	}
}

export class PrescriptionsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexPrescriptions';
	readonly clinicalId = PrescriptionsEditorInput.ID;
	readonly clinicalLabel = 'Prescriptions';
	readonly clinicalIcon = 'beaker';
}

export class ImmunizationsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexImmunizations';
	readonly clinicalId = ImmunizationsEditorInput.ID;
	readonly clinicalLabel = 'Immunizations';
	readonly clinicalIcon = 'shield';
}

export class ReferralsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexReferrals';
	readonly clinicalId = ReferralsEditorInput.ID;
	readonly clinicalLabel = 'Referrals';
	readonly clinicalIcon = 'arrow-right';
}

export class CarePlansEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexCarePlans';
	readonly clinicalId = CarePlansEditorInput.ID;
	readonly clinicalLabel = 'Care Plans';
	readonly clinicalIcon = 'heart';
}

export class CdsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexCds';
	readonly clinicalId = CdsEditorInput.ID;
	readonly clinicalLabel = 'Clinical Decision Support';
	readonly clinicalIcon = 'warning';
}

export class AuthorizationsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexAuthorizations';
	readonly clinicalId = AuthorizationsEditorInput.ID;
	readonly clinicalLabel = 'Authorizations';
	readonly clinicalIcon = 'verified';
}

// allow-any-unicode-next-line
// ─── Appointments EditorInput (singleton) ───

export class AppointmentsEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexAppointments';
	override get typeId(): string { return AppointmentsEditorInput.ID; }
	constructor() { super(); }
	override getName(): string { return 'Appointments'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('checklist'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-appointments', path: '/appointments' }); }
	override matches(other: EditorInput | IUntypedEditorInput): boolean { return other instanceof AppointmentsEditorInput; }
}

// allow-any-unicode-next-line
// ─── Additional Clinical EditorInputs ───

export class LabsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexLabs';
	readonly clinicalId = LabsEditorInput.ID;
	readonly clinicalLabel = 'Labs';
	readonly clinicalIcon = 'beaker';
}

export class EducationEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexEducation';
	readonly clinicalId = EducationEditorInput.ID;
	readonly clinicalLabel = 'Patient Education';
	readonly clinicalIcon = 'book';
}

// allow-any-unicode-next-line
// ─── Operations EditorInputs ───

export class RecallEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexRecall';
	readonly clinicalId = RecallEditorInput.ID;
	readonly clinicalLabel = 'Patient Recall';
	readonly clinicalIcon = 'bell';
}

export class CodesEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexCodes';
	readonly clinicalId = CodesEditorInput.ID;
	readonly clinicalLabel = 'Medical Codes';
	readonly clinicalIcon = 'file';
}

export class InventoryEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexInventory';
	readonly clinicalId = InventoryEditorInput.ID;
	readonly clinicalLabel = 'Inventory';
	readonly clinicalIcon = 'package';
}

export class PaymentsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexPayments';
	readonly clinicalId = PaymentsEditorInput.ID;
	readonly clinicalLabel = 'Payments';
	readonly clinicalIcon = 'credit-card';
}

export class ClaimsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexClaims';
	readonly clinicalId = ClaimsEditorInput.ID;
	readonly clinicalLabel = 'Claims';
	readonly clinicalIcon = 'file';
}

// allow-any-unicode-next-line
// ─── System EditorInputs (singleton, no params) ───

export class ConsentsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexConsents';
	readonly clinicalId = ConsentsEditorInput.ID;
	readonly clinicalLabel = 'Consents';
	readonly clinicalIcon = 'file';
}

export class NotificationsEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexNotifications';
	readonly clinicalId = NotificationsEditorInput.ID;
	readonly clinicalLabel = 'Notifications';
	readonly clinicalIcon = 'bell';
}

export class FaxEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexFax';
	readonly clinicalId = FaxEditorInput.ID;
	readonly clinicalLabel = 'Fax';
	readonly clinicalIcon = 'mail';
}

export class DocScanningEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexDocScanning';
	readonly clinicalId = DocScanningEditorInput.ID;
	readonly clinicalLabel = 'Document Scanning';
	readonly clinicalIcon = 'file-media';
}

export class KioskEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexKiosk';
	readonly clinicalId = KioskEditorInput.ID;
	readonly clinicalLabel = 'Check-in Kiosk';
	readonly clinicalIcon = 'device-desktop';
}

export class AuditLogEditorInput extends BaseClinicalEditorInput {
	static readonly ID = 'workbench.input.ciyexAuditLog';
	readonly clinicalId = AuditLogEditorInput.ID;
	readonly clinicalLabel = 'Audit Log';
	readonly clinicalIcon = 'list-ordered';
}

// allow-any-unicode-next-line
// ─── Developer Portal EditorInput ───

export class DeveloperPortalEditorInput extends EditorInput {
	static readonly ID = 'workbench.input.ciyexDeveloperPortal';
	override get typeId(): string { return DeveloperPortalEditorInput.ID; }

	constructor(
		readonly section: string = 'overview',
	) { super(); }

	override getName(): string { return 'Developer Portal'; }
	override getIcon(): ThemeIcon | undefined { return ThemeIcon.fromId('code'); }
	get resource(): URI { return URI.from({ scheme: 'ciyex-developer', path: `/${this.section}` }); }

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) { return true; }
		return other instanceof DeveloperPortalEditorInput && this.section === other.section;
	}
}

// Keep backward compat alias
export const CiyexConfigEditorInput = LayoutEditorInput;
