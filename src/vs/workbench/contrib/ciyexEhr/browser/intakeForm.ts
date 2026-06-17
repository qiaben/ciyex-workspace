/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize, localize2 } from '../../../../nls.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import * as DOM from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { findWorkbenchRoot } from './customDropdown.js';

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

/** The details collected by the intake form, ready to POST to the backend. */
interface IIntakeFormResult {
	patientId?: string;
	recipientName?: string;
	channel: 'SMS' | 'EMAIL';
	phone?: string;
	email?: string;
}

/** A patient returned by the search-as-you-type lookup. */
interface IPatientMatch {
	patientId?: string;
	name: string;
	dateOfBirth?: string;
	phone?: string;
	email?: string;
}

/**
 * Send a patient-intake form to a patient by SMS or email.
 *
 * Clicking "Send Intake" opens an in-app form where staff pick an existing
 * patient (search-as-you-type) or enter someone not yet in the system, choose a
 * channel, and confirm. The backend mints a tokenized public link and
 * dispatches it through ciyex-comm; for a brand-new patient it creates the
 * record when they submit. The completed submission lands in the "Form Reviews"
 * pending pane.
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
		const apiService = accessor.get(ICiyexApiService);
		const notificationService = accessor.get(INotificationService);
		const openerService = accessor.get(IOpenerService);

		// When launched from an appointment row we already know the patient but
		// usually only their id — pull their contact details so the form opens
		// pre-filled and staff don't have to retype anything.
		const prefill: IIntakeTarget = { ...target };
		if (prefill.patientId && !prefill.phone && !prefill.email) {
			try {
				const pr = await apiService.fetch(`/api/patients/${encodeURIComponent(prefill.patientId)}`);
				if (pr.ok) {
					const pd = await pr.json();
					const p = (pd?.data ?? pd) as Record<string, string>;
					prefill.phone = p?.phoneNumber || p?.mobilePhone || undefined;
					prefill.email = p?.email || undefined;
				}
			} catch {
				// fall back to a blank contact — the form lets staff fill it in.
			}
		}

		// Open the form and collect the details. Returns undefined when cancelled.
		const result = await openIntakeForm(apiService, prefill);
		if (!result) {
			return;
		}

		// Ask the backend to mint a token, send via ciyex-comm, and return the link.
		try {
			const res = await apiService.fetch('/api/intake/send', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					patientId: result.patientId,
					recipientName: result.recipientName,
					channel: result.channel,
					phone: result.phone,
					email: result.email,
					formKey: 'intake',
				}),
			});
			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new Error(`${res.status}${body ? `: ${body}` : ''}`);
			}
			const data = await res.json().catch(() => ({})) as ISendIntakeResponse;
			const link = data?.link;
			const who = result.recipientName || result.phone || result.email || localize('intakeThePatient', "the patient");
			const channelLabel = result.channel === 'SMS' ? localize('intakeSms', "SMS") : localize('intakeEmail', "email");

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

// Shared styling, kept in step with the themed modal used elsewhere in the EHR
// (clinicalListEditor.showThemedModal) so the intake form matches the rest of
// the app in both light and dark themes.
const INPUT_STYLE = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
const LABEL_STYLE = 'display:block;font-size:11px;margin-bottom:4px;color:var(--vscode-descriptionForeground);';

/**
 * Render the intake form as a centre-screen modal mounted inside
 * `.monaco-workbench` (so theme CSS variables resolve). Resolves to the entered
 * details, or `undefined` when the form is cancelled.
 */
function openIntakeForm(apiService: ICiyexApiService, prefill: IIntakeTarget): Promise<IIntakeFormResult | undefined> {
	return new Promise<IIntakeFormResult | undefined>(resolve => {
		const doc = mainWindow.document;
		const mount = findWorkbenchRoot(doc.body || doc.documentElement, doc);

		const overlay = DOM.append(mount, DOM.$('div'));
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;color:var(--vscode-foreground);background:transparent;';

		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.12);';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'position:relative;width:440px;max-width:92vw;max-height:90vh;overflow-y:auto;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,0.4);padding:20px;box-sizing:border-box;';

		const titleEl = DOM.append(modal, DOM.$('h3'));
		titleEl.textContent = localize('intakeFormTitle', "Send Intake Form");
		titleEl.style.cssText = 'margin:0 0 8px;font-size:16px;font-weight:600;';

		const sub = DOM.append(modal, DOM.$('p'));
		sub.textContent = localize('intakeFormSubtitle', "Pick an existing patient or send to someone new. They get a secure link to complete before their visit.");
		sub.style.cssText = 'margin:0 0 16px;font-size:12px;color:var(--vscode-descriptionForeground);';

		// -- Current selection state ---
		let patientId: string | undefined = prefill.patientId;
		// Track whether the channel was set by the user; until then we keep it in
		// sync with whichever contact details are present.
		let channelTouched = false;
		let channel: 'SMS' | 'EMAIL' = prefill.phone && !prefill.email ? 'SMS' : prefill.email ? 'EMAIL' : 'SMS';

		// -- Patient search field ---
		const searchGrp = DOM.append(modal, DOM.$('div'));
		searchGrp.style.cssText = 'margin-bottom:12px;position:relative;';
		const searchLbl = DOM.append(searchGrp, DOM.$('label'));
		searchLbl.textContent = localize('intakePatient', "Patient");
		searchLbl.style.cssText = LABEL_STYLE;
		const searchInput = DOM.append(searchGrp, DOM.$('input')) as HTMLInputElement;
		searchInput.type = 'text';
		searchInput.value = prefill.patientName ?? '';
		searchInput.placeholder = localize('intakePatientPlaceholder', "Search a patient, or type a name to send to someone new…");
		searchInput.style.cssText = INPUT_STYLE;

		const results = DOM.append(searchGrp, DOM.$('div'));
		results.style.cssText = 'position:absolute;left:0;right:0;top:100%;margin-top:2px;z-index:10;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:4px;box-shadow:0 6px 16px rgba(0,0,0,0.3);max-height:220px;overflow-y:auto;display:none;';

		// -- New-patient contact fields ---
		const nameGrp = DOM.append(modal, DOM.$('div'));
		nameGrp.style.cssText = 'margin-bottom:12px;';
		const nameLbl = DOM.append(nameGrp, DOM.$('label'));
		nameLbl.textContent = localize('intakeName', "Name") + ' *';
		nameLbl.style.cssText = LABEL_STYLE;
		const nameInput = DOM.append(nameGrp, DOM.$('input')) as HTMLInputElement;
		nameInput.type = 'text';
		nameInput.value = prefill.patientName ?? '';
		nameInput.placeholder = localize('intakeNamePlaceholder', "Patient's full name");
		nameInput.style.cssText = INPUT_STYLE;

		const phoneGrp = DOM.append(modal, DOM.$('div'));
		phoneGrp.style.cssText = 'margin-bottom:12px;';
		const phoneLbl = DOM.append(phoneGrp, DOM.$('label'));
		phoneLbl.textContent = localize('intakePhone', "Mobile phone");
		phoneLbl.style.cssText = LABEL_STYLE;
		const phoneInput = DOM.append(phoneGrp, DOM.$('input')) as HTMLInputElement;
		phoneInput.type = 'tel';
		phoneInput.value = prefill.phone ?? '';
		phoneInput.placeholder = '+1 555 123 4567';
		phoneInput.style.cssText = INPUT_STYLE;

		const emailGrp = DOM.append(modal, DOM.$('div'));
		emailGrp.style.cssText = 'margin-bottom:12px;';
		const emailLbl = DOM.append(emailGrp, DOM.$('label'));
		emailLbl.textContent = localize('intakeEmail2', "Email");
		emailLbl.style.cssText = LABEL_STYLE;
		const emailInput = DOM.append(emailGrp, DOM.$('input')) as HTMLInputElement;
		emailInput.type = 'email';
		emailInput.value = prefill.email ?? '';
		emailInput.placeholder = 'patient@example.com';
		emailInput.style.cssText = INPUT_STYLE;

		// -- Channel selector (SMS / Email) ---
		const channelGrp = DOM.append(modal, DOM.$('div'));
		channelGrp.style.cssText = 'margin-bottom:16px;';
		const channelLbl = DOM.append(channelGrp, DOM.$('label'));
		channelLbl.textContent = localize('intakeSendVia', "Send via");
		channelLbl.style.cssText = LABEL_STYLE;
		const seg = DOM.append(channelGrp, DOM.$('div'));
		seg.style.cssText = 'display:flex;gap:8px;';

		const smsBtn = DOM.append(seg, DOM.$('button')) as HTMLButtonElement;
		smsBtn.type = 'button';
		smsBtn.textContent = localize('intakeChannelSms', "Text message (SMS)");
		const emailBtn = DOM.append(seg, DOM.$('button')) as HTMLButtonElement;
		emailBtn.type = 'button';
		emailBtn.textContent = localize('intakeChannelEmail', "Email");

		const paintChannel = () => {
			const on = 'flex:1;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px;border:1px solid var(--vscode-focusBorder);background:var(--vscode-button-background);color:var(--vscode-button-foreground,#fff);';
			const off = 'flex:1;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:12px;border:1px solid var(--vscode-input-border,#3c3c3c);background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));';
			smsBtn.style.cssText = channel === 'SMS' ? on : off;
			emailBtn.style.cssText = channel === 'EMAIL' ? on : off;
		};
		smsBtn.addEventListener('click', () => { channel = 'SMS'; channelTouched = true; paintChannel(); });
		emailBtn.addEventListener('click', () => { channel = 'EMAIL'; channelTouched = true; paintChannel(); });
		paintChannel();

		// Keep the channel aligned with the contact the user is actually filling
		// in, until they pick one explicitly.
		const autoChannel = () => {
			if (channelTouched) { return; }
			if (phoneInput.value.trim() && !emailInput.value.trim()) { channel = 'SMS'; }
			else if (emailInput.value.trim() && !phoneInput.value.trim()) { channel = 'EMAIL'; }
			paintChannel();
		};
		phoneInput.addEventListener('input', autoChannel);
		emailInput.addEventListener('input', autoChannel);

		// -- Patient search-as-you-type ---
		let debounceTimer: ReturnType<typeof setTimeout> | undefined;
		let cts: CancellationTokenSource | undefined;

		const hideResults = () => { results.style.display = 'none'; results.replaceChildren(); };

		const selectPatient = (m: IPatientMatch) => {
			patientId = m.patientId;
			searchInput.value = m.name;
			nameInput.value = m.name;
			phoneInput.value = m.phone ?? '';
			emailInput.value = m.email ?? '';
			autoChannel();
			hideResults();
		};

		const renderResults = (matches: IPatientMatch[]) => {
			results.replaceChildren();
			if (!matches.length) { results.style.display = 'none'; return; }
			for (const m of matches) {
				const row = DOM.append(results, DOM.$('div'));
				row.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--vscode-editorWidget-border);';
				const detail = [m.dateOfBirth, m.phone, m.email].filter(Boolean).join(' · ');
				row.textContent = detail ? `${m.name} — ${detail}` : m.name;
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
				row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
				row.addEventListener('mousedown', e => { e.preventDefault(); selectPatient(m); });
			}
			results.style.display = 'block';
		};

		searchInput.addEventListener('input', () => {
			// Typing a new value means we're no longer pointing at the picked record.
			patientId = undefined;
			nameInput.value = searchInput.value;
			const value = searchInput.value.trim();
			if (debounceTimer) { clearTimeout(debounceTimer); }
			if (cts) { cts.cancel(); }
			if (!value) { hideResults(); return; }
			debounceTimer = setTimeout(async () => {
				cts = new CancellationTokenSource();
				try {
					const response = await apiService.fetch(`/api/patients?search=${encodeURIComponent(value)}&page=0&size=15`);
					if (cts.token.isCancellationRequested) { return; }
					if (!response.ok) { hideResults(); return; }
					const data = await response.json();
					const patients = (data?.data?.content || data?.content || []) as Record<string, string>[];
					const q = value.toLowerCase();
					const matches = patients.filter(p => {
						const first = (p.firstName || '').toLowerCase();
						const last = (p.lastName || '').toLowerCase();
						const middle = (p.middleName || '').toLowerCase();
						return first.startsWith(q) || last.startsWith(q) || (middle.length > 0 && middle.startsWith(q));
					}).map((p): IPatientMatch => ({
						patientId: p.fhirId || p.id,
						name: `${p.firstName || ''} ${p.lastName || ''}`.trim(),
						dateOfBirth: p.dateOfBirth || undefined,
						phone: p.phoneNumber || p.mobilePhone || undefined,
						email: p.email || undefined,
					}));
					renderResults(matches);
				} catch {
					hideResults();
				}
			}, 300);
		});
		searchInput.addEventListener('blur', () => setTimeout(hideResults, 150));

		// -- Footer + validation ---
		const error = DOM.append(modal, DOM.$('div'));
		error.style.cssText = 'color:var(--vscode-inputValidation-errorForeground,#f48771);font-size:11px;margin-bottom:8px;min-height:14px;';

		const footer = DOM.append(modal, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:4px;';

		let settled = false;
		const close = (result: IIntakeFormResult | undefined) => {
			if (settled) { return; }
			settled = true;
			if (debounceTimer) { clearTimeout(debounceTimer); }
			if (cts) { cts.cancel(); }
			overlay.remove();
			resolve(result);
		};

		const cancelBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.type = 'button';
		cancelBtn.textContent = localize('intakeCancel', "Cancel");
		cancelBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => close(undefined));

		const sendBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		sendBtn.type = 'button';
		sendBtn.textContent = localize('intakeSend', "Send Intake Form");
		sendBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		const flag = (el: HTMLInputElement, msg: string) => {
			error.textContent = msg;
			el.style.borderColor = 'var(--vscode-inputValidation-errorBorder,#be1100)';
			el.focus();
		};
		sendBtn.addEventListener('click', () => {
			error.textContent = '';
			const name = nameInput.value.trim();
			const phone = phoneInput.value.trim();
			const email = emailInput.value.trim();
			if (!name) { flag(nameInput, localize('intakeNeedName', "Enter the patient's name.")); return; }
			if (channel === 'SMS' && !phone) { flag(phoneInput, localize('intakeNeedPhone', "Enter a mobile number to send by SMS.")); return; }
			if (channel === 'EMAIL' && !email) { flag(emailInput, localize('intakeNeedEmail', "Enter an email address to send by email.")); return; }
			close({
				patientId,
				recipientName: name,
				channel,
				phone: phone || undefined,
				email: email || undefined,
			});
		});

		backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { close(undefined); } });
		overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { close(undefined); } });

		(prefill.patientName ? phoneInput : searchInput).focus();
	});
}
