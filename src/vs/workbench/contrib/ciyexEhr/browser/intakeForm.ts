/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize, localize2 } from '../../../../nls.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { ICiyexApiService } from './ciyexApiService.js';

interface IPatientQuickPick extends IQuickPickItem {
	patientId?: string;
	patientName?: string;
	phone?: string;
	email?: string;
	isNew?: boolean;
}

interface IChannelQuickPick extends IQuickPickItem {
	channel: 'SMS' | 'EMAIL';
}

interface ISendIntakeResponse {
	link?: string;
	channel?: string;
}

/** Optional pre-selected patient passed when invoked from an appointment row. */
interface IIntakeTarget {
	patientId?: string;
	patientName?: string;
	phone?: string;
	email?: string;
}

/**
 * Send a patient-intake form to a patient by SMS or email.
 *
 * The patient can be an existing record (picked via search) or someone not yet
 * in the system — in which case we send to a raw phone/email and the backend
 * creates the patient when they submit the form. The backend mints a tokenized
 * public link and dispatches it through ciyex-comm; the completed submission
 * lands in the "Form Reviews" pending pane.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.sendIntakeForm',
			title: localize2('sendIntakeForm', "Send Intake Form to Patient"),
			category: localize2('intakeCategory', "Ciyex Intake"),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, target?: IIntakeTarget): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const apiService = accessor.get(ICiyexApiService);
		const notificationService = accessor.get(INotificationService);
		const openerService = accessor.get(IOpenerService);

		// 1. Pick the recipient. When invoked from an appointment row the patient
		//    is already known, so skip the search.
		const recipient: IPatientQuickPick | undefined = (target && (target.patientId || target.phone || target.email))
			? { label: target.patientName || '', patientId: target.patientId, patientName: target.patientName, phone: target.phone, email: target.email }
			: await pickRecipient(quickInputService, apiService);
		if (!recipient) {
			return;
		}

		// When launched from an appointment we only know the patient id — pull
		// their phone/email so staff don't have to retype contact details.
		if (recipient.patientId && !recipient.phone && !recipient.email) {
			try {
				const pr = await apiService.fetch(`/api/patients/${encodeURIComponent(recipient.patientId)}`);
				if (pr.ok) {
					const pd = await pr.json();
					const p = (pd?.data ?? pd) as Record<string, string>;
					recipient.phone = p?.phoneNumber || p?.mobilePhone || undefined;
					recipient.email = p?.email || undefined;
				}
			} catch {
				// fall back to prompting for the address
			}
		}

		// 2. Decide the channel. Prefer whichever contact detail we already have;
		//    ask when the patient has both (or neither, for a new recipient).
		const channel = await resolveChannel(quickInputService, recipient);
		if (!channel) {
			return;
		}

		// 3. For a new recipient, collect the address for the chosen channel.
		let phone = recipient.phone;
		let email = recipient.email;
		if (channel === 'SMS' && !phone) {
			phone = await quickInputService.input({
				prompt: localize('intakePhonePrompt', "Mobile number to text the intake form to"),
				placeHolder: '+1 555 123 4567',
			});
			if (!phone) { return; }
		}
		if (channel === 'EMAIL' && !email) {
			email = await quickInputService.input({
				prompt: localize('intakeEmailPrompt', "Email address to send the intake form to"),
				placeHolder: 'patient@example.com',
			});
			if (!email) { return; }
		}

		// 4. Ask the backend to mint a token, send via ciyex-comm, and return the link.
		try {
			const res = await apiService.fetch('/api/intake/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					patientId: recipient.patientId,
					recipientName: recipient.patientName,
					channel,
					phone,
					email,
					formKey: 'intake',
				}),
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new Error(`${res.status}${body ? `: ${body}` : ''}`);
			}
			const data = await res.json().catch(() => ({})) as ISendIntakeResponse;
			const link = data?.link;
			const who = recipient.patientName || phone || email || localize('intakeThePatient', "the patient");
			const channelLabel = channel === 'SMS' ? localize('intakeSms', "SMS") : localize('intakeEmail', "email");

			notificationService.notify({
				severity: Severity.Info,
				message: localize('intakeSent', "Intake form sent to {0} via {1}. It appears in Form Reviews once submitted.", who, channelLabel),
				actions: link ? {
					primary: [{
						id: 'ciyex.intake.openLink',
						label: localize('intakeOpenLink', "Open Form Link"),
						tooltip: '', class: undefined, enabled: true,
						// The intake link is a public patient-facing page — open it in
						// the user's real external browser, not an in-app tab.
						run: async () => { await openerService.open(URI.parse(link), { openExternal: true }); },
					}],
				} : undefined,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			notificationService.notify({ severity: Severity.Error, message: localize('intakeSendFailed', "Couldn't send the intake form: {0}", message) });
		}
	}
});

/**
 * Search-as-you-type patient picker that also offers a "new patient" entry so
 * the form can be sent to someone who isn't in the system yet.
 */
async function pickRecipient(quickInputService: IQuickInputService, apiService: ICiyexApiService): Promise<IPatientQuickPick | undefined> {
	return new Promise<IPatientQuickPick | undefined>(resolve => {
		const picker = quickInputService.createQuickPick<IPatientQuickPick>();
		picker.placeholder = localize('intakePickPatient', "Search a patient, or type a name to send to someone new…");
		picker.matchOnDescription = true;
		picker.matchOnDetail = true;

		const newEntry = (value: string): IPatientQuickPick => ({
			label: '$(add) ' + localize('intakeNewPatient', "New patient — send to a phone or email"),
			description: value.trim() || undefined,
			patientName: value.trim() || undefined,
			isNew: true,
			alwaysShow: true,
		});
		picker.items = [newEntry('')];

		let debounceTimer: ReturnType<typeof setTimeout> | undefined;
		let cts: CancellationTokenSource | undefined;

		picker.onDidChangeValue(value => {
			if (debounceTimer) { clearTimeout(debounceTimer); }
			if (cts) { cts.cancel(); }

			if (!value.trim()) {
				picker.items = [newEntry('')];
				picker.busy = false;
				return;
			}

			picker.busy = true;
			debounceTimer = setTimeout(async () => {
				cts = new CancellationTokenSource();
				try {
					const response = await apiService.fetch(`/api/patients?search=${encodeURIComponent(value.trim())}&page=0&size=15`);
					if (cts.token.isCancellationRequested) { return; }
					if (response.ok) {
						const data = await response.json();
						const patients = (data?.data?.content || data?.content || []) as Record<string, string>[];
						const q = value.trim().toLowerCase();
						const prefixMatch = (p: Record<string, string>): boolean => {
							const first = (p.firstName || '').toLowerCase();
							const last = (p.lastName || '').toLowerCase();
							const middle = (p.middleName || '').toLowerCase();
							return first.startsWith(q) || last.startsWith(q) || (middle.length > 0 && middle.startsWith(q));
						};
						const matches = patients.filter(prefixMatch).map((p): IPatientQuickPick => ({
							label: `$(account) ${p.lastName}, ${p.firstName}`,
							description: `${p.dateOfBirth || ''} ${p.phoneNumber || ''} ${p.email || ''}`.trim() || undefined,
							patientId: p.fhirId || p.id,
							patientName: `${p.firstName} ${p.lastName}`,
							phone: p.phoneNumber || undefined,
							email: p.email || undefined,
						}));
						picker.items = [...matches, newEntry(value)];
					}
				} catch {
					// ignore search errors — the "new patient" entry stays available
				}
				picker.busy = false;
			}, 300);
		});

		const finish = (result: IPatientQuickPick | undefined): void => {
			if (debounceTimer) { clearTimeout(debounceTimer); }
			if (cts) { cts.cancel(); }
			picker.dispose();
			resolve(result);
		};

		picker.onDidAccept(() => finish(picker.selectedItems[0]));
		picker.onDidHide(() => finish(undefined));
		picker.show();
	});
}

/**
 * Choose SMS vs email. When the recipient already has exactly one contact
 * detail we use it without prompting; otherwise we ask.
 */
async function resolveChannel(quickInputService: IQuickInputService, recipient: IPatientQuickPick): Promise<'SMS' | 'EMAIL' | undefined> {
	const hasPhone = !!recipient.phone;
	const hasEmail = !!recipient.email;
	if (hasPhone && !hasEmail) { return 'SMS'; }
	if (hasEmail && !hasPhone) { return 'EMAIL'; }

	const items: IChannelQuickPick[] = [
		{ label: '$(device-mobile) ' + localize('intakeChannelSms', "Text message (SMS)"), description: recipient.phone, channel: 'SMS' },
		{ label: '$(mail) ' + localize('intakeChannelEmail', "Email"), description: recipient.email, channel: 'EMAIL' },
	];
	const picked = await quickInputService.pick(items, {
		placeHolder: localize('intakePickChannel', "How should we send the intake form?"),
	});
	return picked?.channel;
}
