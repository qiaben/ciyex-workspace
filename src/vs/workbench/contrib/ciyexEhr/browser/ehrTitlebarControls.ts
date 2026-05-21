/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import * as DOM from '../../../../base/browser/dom.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';

interface PatientResult {
	id: string;
	fhirId?: string;
	firstName: string;
	lastName: string;
	dateOfBirth?: string;
	gender?: string;
	email?: string;
	phoneNumber?: string;
}

interface ProviderResult {
	id: string;
	fhirId?: string;
	firstName?: string;
	lastName?: string;
	name?: string;
	fullName?: string;
	username?: string;
	'identification.firstName'?: string;
	'identification.lastName'?: string;
	'identification.prefix'?: string;
}

interface LocationResult {
	id: string;
	name: string;
}

/**
 * EHR Titlebar Controls — search bar, add patient, add appointment buttons.
 * Inserted into the titlebar right section.
 */
export class EhrTitlebarControls extends Disposable {

	/** Search bar — placed in the titlebar centre. */
	readonly searchElement: HTMLElement;

	/** Action buttons (patient, appointment, currency) — placed in the titlebar right. */
	readonly element: HTMLElement;

	private searchInput!: HTMLInputElement;
	private searchDropdown!: HTMLElement;
	private patientOverlay!: HTMLElement;
	private appointmentOverlay!: HTMLElement;
	private overlayBackdrop!: HTMLElement;

	private searchCts: CancellationTokenSource | undefined;
	private searchTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly apiService: ICiyexApiService,
		private readonly commandService: ICommandService,
		private readonly notificationService: INotificationService,
	) {
		super();

		this.searchElement = DOM.$('.ehr-titlebar-search-wrapper');
		this.element = DOM.$('.ehr-titlebar-controls');
		this._buildSearchBar();
		this._buildAddPatientButton();
		this._buildAddAppointmentButton();
		this._buildCurrencyButton();
		this._buildPatientOverlay();
		this._buildAppointmentOverlay();

		// Allow other components (e.g. schedule sidebar) to open the appointment form
		this._register(CommandsRegistry.registerCommand('ciyex.showAddAppointmentForm', () => {
			this._toggleAppointmentOverlay();
		}));

		// Close overlays on outside click
		this._register(DOM.addDisposableListener(DOM.getActiveWindow().document, DOM.EventType.MOUSE_DOWN, (e) => {
			if (!this.element.contains(e.target as Node) &&
				!this.searchElement.contains(e.target as Node) &&
				!this.patientOverlay.contains(e.target as Node) &&
				!this.appointmentOverlay.contains(e.target as Node) &&
				!this.searchDropdown.contains(e.target as Node)) {
				this._closeAllOverlays();
			}
		}));
	}

	// --- Search Bar ---

	private _buildSearchBar(): void {
		const searchContainer = DOM.append(this.searchElement, DOM.$('.ehr-search-container'));

		const searchIcon = DOM.append(searchContainer, DOM.$('span.ehr-search-icon'));
		searchIcon.textContent = '\uEB51'; // codicon search
		searchIcon.classList.add('codicon');
		searchIcon.classList.add('codicon-search');

		this.searchInput = DOM.append(searchContainer, DOM.$('input.ehr-search-input')) as HTMLInputElement;
		this.searchInput.type = 'text';
		this.searchInput.placeholder = 'Search by name or DOB (MM/DD/YYYY)...';
		this.searchInput.setAttribute('aria-label', 'Search patients');

		const kbdHint = DOM.append(searchContainer, DOM.$('span.ehr-kbd-hint'));
		kbdHint.textContent = '\u2318K';

		// Appended to body (not inside searchContainer) so it escapes the
		// titlebar-container's overflow:hidden. Position is set via _positionSearchDropdown().
		this.searchDropdown = DOM.$('.ehr-search-dropdown');
		this.searchDropdown.style.display = 'none';
		DOM.getActiveWindow().document.body.appendChild(this.searchDropdown);

		this._register(DOM.addDisposableListener(this.searchInput, 'input', () => this._onSearchInput()));
		this._register(DOM.addDisposableListener(this.searchInput, 'focus', () => {
			this._onSearchInput();
		}));
		this._register(DOM.addDisposableListener(this.searchInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.searchInput.blur();
				this.searchDropdown.style.display = 'none';
			}
		}));
	}

	private _positionSearchDropdown(): void {
		const rect = this.searchInput.getBoundingClientRect();
		this.searchDropdown.style.top = `${rect.bottom + 4}px`;
		this.searchDropdown.style.left = `${rect.left}px`;
		this.searchDropdown.style.width = `${Math.max(rect.width, 300)}px`;
	}

	private _onSearchInput(): void {
		if (this.searchTimer) { clearTimeout(this.searchTimer); }
		if (this.searchCts) { this.searchCts.cancel(); }

		const value = this.searchInput.value.trim();

		this._ensureInWorkbench(this.searchDropdown);
		DOM.clearNode(this.searchDropdown);
		const loading = DOM.append(this.searchDropdown, DOM.$('.ehr-search-empty'));
		loading.textContent = value ? `Searching for "${value}"…` : 'Type to search patients or providers';
		this._positionSearchDropdown();
		this.searchDropdown.style.display = '';

		this.searchTimer = setTimeout(async () => {
			this.searchCts = new CancellationTokenSource();
			try {
				const extract = (data: unknown): unknown[] => {
					const d = data as { data?: { content?: unknown[] } | unknown[]; content?: unknown[] } | unknown[];
					if (Array.isArray(d)) { return d; }
					const dObj = d as { data?: { content?: unknown[] } | unknown[]; content?: unknown[] };
					if (dObj?.data && typeof dObj.data === 'object' && !Array.isArray(dObj.data) && Array.isArray((dObj.data as { content?: unknown[] }).content)) {
						return (dObj.data as { content: unknown[] }).content;
					}
					if (Array.isArray(dObj?.data)) { return dObj.data as unknown[]; }
					if (Array.isArray(dObj?.content)) { return dObj.content; }
					return [];
				};

				const [patRes, provRes] = await Promise.all([
					this.apiService.fetch(`/api/patients?search=${encodeURIComponent(value)}&page=0&size=50`).catch(() => null),
					this.apiService.fetch(`/api/fhir-resource/providers?page=0&size=100`).catch(() => null),
				]);

				if (this.searchCts.token.isCancellationRequested) { return; }

				const rawPatients = patRes && patRes.ok ? extract(await patRes.json()) as PatientResult[] : [];
				const rawProviders = provRes && provRes.ok ? extract(await provRes.json()) as ProviderResult[] : [];

				const patients = value ? this._clientFilterPatients(rawPatients, value).slice(0, 8) : [];
				const providers = value ? this._clientFilterProviders(rawProviders, value).slice(0, 8) : [];

				this._renderSearchResults(patients, providers);
			} catch {
				if (this.searchCts.token.isCancellationRequested) { return; }
				this._renderSearchResults([], []);
			}
		}, 300);
	}

	private _clientFilterProviders(rows: ProviderResult[], rawQuery: string): ProviderResult[] {
		const q = rawQuery.toLowerCase();
		return rows.filter(p => {
			const first = p.firstName || p['identification.firstName'] || '';
			const last = p.lastName || p['identification.lastName'] || '';
			const name = (p.name || p.fullName || `${first} ${last}`.trim() || p.username || '').toLowerCase();
			return name.includes(q);
		});
	}

	private _clientFilterPatients(rows: PatientResult[], rawQuery: string): PatientResult[] {
		const q = rawQuery.toLowerCase();
		const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawQuery);
		const isoFromUs = usDate ? `${usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}` : '';
		return rows.filter(p => {
			const fullName = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase();
			const reversed = `${p.lastName || ''} ${p.firstName || ''}`.toLowerCase();
			if (fullName.includes(q) || reversed.includes(q)) { return true; }
			if (isoFromUs && (p.dateOfBirth || '').startsWith(isoFromUs)) { return true; }
			if ((p.dateOfBirth || '').includes(rawQuery)) { return true; }
			return false;
		});
	}

	private _renderSearchResults(patients: PatientResult[], providers: ProviderResult[] = []): void {
		DOM.clearNode(this.searchDropdown);
		this._positionSearchDropdown();

		if (patients.length === 0 && providers.length === 0) {
			const empty = DOM.append(this.searchDropdown, DOM.$('.ehr-search-empty'));
			empty.textContent = 'No matches';
			this.searchDropdown.style.display = '';
			return;
		}

		const section = (label: string) => {
			const el = DOM.append(this.searchDropdown, DOM.$('.ehr-search-section'));
			el.textContent = label;
			el.style.cssText = 'padding:6px 12px 2px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground,#888);';
		};

		if (patients.length > 0) {
			section('Patients');
			for (const p of patients) {
				const item = DOM.append(this.searchDropdown, DOM.$('.ehr-search-item'));
				const nameEl = DOM.append(item, DOM.$('.ehr-search-name'));
				nameEl.textContent = `${p.firstName} ${p.lastName}`;
				const dobEl = DOM.append(item, DOM.$('.ehr-search-dob'));
				dobEl.textContent = p.dateOfBirth ? `DOB: ${this._formatDisplayDate(p.dateOfBirth)} · View appointments` : 'View appointments';

				const patientName = `${p.firstName} ${p.lastName}`.trim();
				this._register(DOM.addDisposableListener(item, 'click', () => {
					this.searchDropdown.style.display = 'none';
					this.searchInput.value = patientName;
					// Push the value into the calendar filter bridge as well so the
					// calendar grid filters immediately.
					this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
					this.commandService.executeCommand('ciyex.openCalendar').catch(() => { });
				}));
			}
		}

		if (providers.length > 0) {
			section('Providers');
			for (const p of providers) {
				const item = DOM.append(this.searchDropdown, DOM.$('.ehr-search-item'));
				const first = p.firstName || p['identification.firstName'] || '';
				const last = p.lastName || p['identification.lastName'] || '';
				const display = p.name || p.fullName || `${first} ${last}`.trim() || p.username || '';
				const nameEl = DOM.append(item, DOM.$('.ehr-search-name'));
				nameEl.textContent = display;
				const subEl = DOM.append(item, DOM.$('.ehr-search-dob'));
				subEl.textContent = 'View appointments';

				this._register(DOM.addDisposableListener(item, 'click', () => {
					this.searchDropdown.style.display = 'none';
					this.searchInput.value = display;
					this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
					this.commandService.executeCommand('ciyex.openCalendar').catch(() => { });
				}));
			}
		}

		this.searchDropdown.style.display = '';
	}

	// --- Add Patient Button ---

	private _buildAddPatientButton(): void {
		const btn = DOM.append(this.element, DOM.$('.ehr-action-btn.ehr-action-btn-patient'));
		btn.title = 'Add Patient';
		btn.setAttribute('aria-label', 'Add Patient');

		DOM.append(btn, DOM.$('span.codicon.codicon-account'));
		const label = DOM.append(btn, DOM.$('span.ehr-action-label'));
		label.textContent = 'Patient';

		this._register(DOM.addDisposableListener(btn, 'click', (e) => {
			e.stopPropagation();
			this._togglePatientOverlay();
		}));
	}

	// --- Add Appointment Button ---

	private _buildAddAppointmentButton(): void {
		const btn = DOM.append(this.element, DOM.$('.ehr-action-btn.ehr-action-btn-appointment'));
		btn.title = 'Add Appointment';
		btn.setAttribute('aria-label', 'Add Appointment');

		DOM.append(btn, DOM.$('span.codicon.codicon-calendar'));
		const label = DOM.append(btn, DOM.$('span.ehr-action-label'));
		label.textContent = 'Appointment';

		this._register(DOM.addDisposableListener(btn, 'click', (e) => {
			e.stopPropagation();
			this._toggleAppointmentOverlay();
		}));
	}

	// --- Currency Button ---

	private _buildCurrencyButton(): void {
		const btn = DOM.append(this.element, DOM.$('.ehr-action-btn.ehr-action-btn-currency'));
		btn.title = 'Donate';
		btn.setAttribute('aria-label', 'Donate');

		const icon = DOM.append(btn, DOM.$('span.ehr-currency-icon'));
		icon.textContent = '$';
		const label = DOM.append(btn, DOM.$('span.ehr-action-label'));
		label.textContent = 'Donate';

		this._register(DOM.addDisposableListener(btn, 'click', (e) => {
			e.stopPropagation();
			this.commandService.executeCommand('ciyex.openPayments').catch(() => { });
		}));
	}

	// --- Patient Creation Overlay ---

	private _ensureOverlayBackdrop(): void {
		if (this.overlayBackdrop) { return; }
		this.overlayBackdrop = DOM.$('.ehr-overlay-backdrop');
		this.overlayBackdrop.style.display = 'none';
		DOM.getActiveWindow().document.body.appendChild(this.overlayBackdrop);
		this._register(DOM.addDisposableListener(this.overlayBackdrop, 'click', () => this._closeAllOverlays()));
	}

	private _buildPatientOverlay(): void {
		this._ensureOverlayBackdrop();
		this.patientOverlay = DOM.$('.ehr-overlay');
		this.patientOverlay.style.display = 'none';
		DOM.getActiveWindow().document.body.appendChild(this.patientOverlay);

		const header = DOM.append(this.patientOverlay, DOM.$('.ehr-overlay-header'));
		const title = DOM.append(header, DOM.$('h3'));
		title.textContent = 'Create Patient';
		const closeBtn = DOM.append(header, DOM.$('.ehr-overlay-close'));
		closeBtn.textContent = '\u00D7';
		this._register(DOM.addDisposableListener(closeBtn, 'click', () => this._closePatientOverlay()));
		this._makeDraggable(this.patientOverlay, header);

		const form = DOM.append(this.patientOverlay, DOM.$('.ehr-overlay-form'));

		const errorEl = DOM.append(form, DOM.$('.ehr-form-error'));
		errorEl.style.display = 'none';
		this._patientFormElements.errorEl = errorEl;

		// Row 1: First Name, Middle Name, Last Name
		const row1 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-3'));
		const firstName = this._createField(row1, 'First Name', 'text', true, 'firstName') as HTMLInputElement;
		const middleName = this._createField(row1, 'Middle Name', 'text', false, 'middleName') as HTMLInputElement;
		const lastName = this._createField(row1, 'Last Name', 'text', true, 'lastName') as HTMLInputElement;

		// Row 2: Phone, Gender
		const row2 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		const phone = this._createField(row2, 'Phone Number', 'tel', true, 'phoneNumber') as HTMLInputElement;
		// US phone: 10 digits, formatted as (xxx) xxx-xxxx
		phone.setAttribute('inputmode', 'numeric');
		phone.setAttribute('autocomplete', 'tel-national');
		phone.maxLength = 14;
		phone.placeholder = '(555) 555-5555';
		const formatPhone = () => {
			const digits = phone.value.replace(/\D/g, '').slice(0, 10);
			let formatted = digits;
			if (digits.length > 6) { formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`; }
			else if (digits.length > 3) { formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`; }
			else if (digits.length > 0) { formatted = `(${digits}`; }
			phone.value = formatted;
		};
		this._register(DOM.addDisposableListener(phone, 'input', formatPhone));
		this._register(DOM.addDisposableListener(phone, 'paste', () => setTimeout(formatPhone, 0)));
		// Block any keystroke that's not a digit, formatting char, or navigation key
		this._register(DOM.addDisposableListener(phone, 'keydown', (e: KeyboardEvent) => {
			const nav = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
			if (nav.includes(e.key) || e.ctrlKey || e.metaKey) { return; }
			if (!/^[0-9]$/.test(e.key)) { e.preventDefault(); }
		}));
		const gender = this._createSelectField(row2, 'Gender', true, 'gender', [
			{ value: '', label: 'Select gender' },
			{ value: 'male', label: 'Male' },
			{ value: 'female', label: 'Female' },
			{ value: 'unknown', label: 'Unknown' },
		]) as HTMLSelectElement;

		// Row 3: DOB, Email
		const row3 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		// DOB rendered as mm/dd/yyyy (US format) with a calendar picker. Native
		// `<input type="date">` renders in OS-locale order on Linux Electron
		// (yyyy-mm-dd) so we render the US format ourselves; `dob.value` (the
		// hidden field used at save) still carries the ISO date.
		const _today = new Date();
		const todayIso = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`;
		const dobGroup = DOM.append(row3, DOM.$('.ehr-form-group'));
		const dobLabelEl = DOM.append(dobGroup, DOM.$('label.ehr-form-label'));
		const dobStar = DOM.append(dobLabelEl, DOM.$('span.ehr-required-star'));
		dobStar.textContent = '*';
		dobLabelEl.append(' Date of Birth');
		const dobWrap = DOM.append(dobGroup, DOM.$('div'));
		dobWrap.style.cssText = 'position:relative;display:block;';
		const dobVisible = DOM.append(dobWrap, DOM.$('input.ehr-form-input')) as HTMLInputElement;
		dobVisible.type = 'text';
		dobVisible.placeholder = 'MM/DD/YYYY';
		dobVisible.maxLength = 10;
		dobVisible.style.paddingRight = '30px';
		dobVisible.style.width = '100%';
		const dob = DOM.append(dobWrap, DOM.$('input')) as HTMLInputElement;
		dob.type = 'hidden';
		dob.name = 'dateOfBirth';
		const dobPicker = DOM.append(dobWrap, DOM.$('input')) as HTMLInputElement;
		dobPicker.type = 'date';
		dobPicker.max = todayIso;
		dobPicker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
		dobPicker.title = 'Open calendar';
		const dobIcon = DOM.append(dobWrap, DOM.$('span'));
		dobIcon.textContent = '\u{1F4C5}';
		dobIcon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--vscode-descriptionForeground);pointer-events:none;line-height:1;';
		const usToIso = (us: string): string => {
			const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us);
			if (!m) { return ''; }
			return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
		};
		const isoToUs = (iso: string): string => {
			const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
			return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
		};
		this._register(DOM.addDisposableListener(dobVisible, 'input', () => {
			const iso = usToIso(dobVisible.value);
			// Never silently cap to today — keep hidden value empty if invalid/future so
			// save-time validation shows the correct error message.
			dob.value = (iso && iso <= todayIso) ? iso : '';
			dobVisible.style.borderColor = dobVisible.value && !dob.value ? '#ef4444' : '';
		}));
		this._register(DOM.addDisposableListener(dobPicker, 'change', () => {
			// Picker enforces max=todayIso at the OS level; just use the raw value.
			dob.value = dobPicker.value;
			dobVisible.value = isoToUs(dobPicker.value);
			dobVisible.style.borderColor = '';
		}));
		const email = this._createField(row3, 'Email', 'email', true, 'email') as HTMLInputElement;

		// Communication Consent
		const consentGroup = DOM.append(form, DOM.$('.ehr-form-group'));
		const consentLabel = DOM.append(consentGroup, DOM.$('label.ehr-form-label'));
		consentLabel.textContent = 'Communication Consent';

		const consentRow = DOM.append(consentGroup, DOM.$('.ehr-consent-row'));
		const emailConsent = this._createCheckbox(consentRow, 'Email', true) as HTMLInputElement;
		const smsConsent = this._createCheckbox(consentRow, 'SMS/Text', true) as HTMLInputElement;
		const voicemailConsent = this._createCheckbox(consentRow, 'Voicemail', true) as HTMLInputElement;

		this._patientFormElements.inputs.push(firstName, middleName, lastName, phone, dob, email, emailConsent, smsConsent, voicemailConsent);
		this._patientFormElements.selects.push(gender);

		// Buttons
		const btnRow = DOM.append(form, DOM.$('.ehr-form-buttons'));
		const cancelBtn = DOM.append(btnRow, DOM.$('button.ehr-btn-cancel'));
		cancelBtn.textContent = 'Cancel';
		this._register(DOM.addDisposableListener(cancelBtn, 'click', () => this._closePatientOverlay()));

		const saveBtn = DOM.append(btnRow, DOM.$('button.ehr-btn-save'));
		saveBtn.textContent = 'Save';

		this._register(DOM.addDisposableListener(saveBtn, 'click', async () => {
			errorEl.style.display = 'none';

			const fName = firstName.value.trim();
			const mName = middleName.value.trim();
			const lName = lastName.value.trim();
			const phoneVal = phone.value.trim();
			const genderVal = gender.value;
			const dobVal = dob.value;
			const emailVal = email.value.trim();

			// Validation
			if (!fName || !lName || !phoneVal || !genderVal || !dobVal || !emailVal) {
				errorEl.textContent = 'Please fill in all required fields.';
				errorEl.style.display = '';
				return;
			}
			const phoneDigits = phoneVal.replace(/\D/g, '');
			if (phoneDigits.length !== 10) {
				errorEl.textContent = 'Phone number must be exactly 10 digits (US format).';
				errorEl.style.display = '';
				return;
			}
			if (dobVal > new Date().toISOString().slice(0, 10)) {
				errorEl.textContent = 'Date of birth cannot be in the future.';
				errorEl.style.display = '';
				return;
			}
			// Email validation — RFC 5322-ish: local@domain.tld with at least one dot in domain
			const emailRe = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
			if (!emailRe.test(emailVal)) {
				errorEl.textContent = 'Please enter a valid email address (e.g. name@example.com).';
				errorEl.style.display = '';
				return;
			}

			const body = {
				firstName: fName,
				middleName: mName || undefined,
				lastName: lName,
				phoneNumber: phoneDigits,
				gender: genderVal,
				dateOfBirth: dobVal,
				email: emailVal,
				status: 'Active',
				allowEmail: emailConsent.checked,
				allowSms: smsConsent.checked,
				allowVoicemail: voicemailConsent.checked,
			};

			saveBtn.setAttribute('disabled', 'true');
			saveBtn.textContent = 'Saving...';

			try {
				const res = await this.apiService.fetch('/api/fhir-resource/demographics', {
					method: 'POST',
					body: JSON.stringify(body),
				});

				if (res.ok) {
					const data = await res.json();
					const patientId = data?.data?.id || data?.id || data?.data?.fhirId || '';
					this.notificationService.notify({ severity: Severity.Info, message: `Patient ${fName} ${lName} created successfully.` });
					this._closePatientOverlay();
					this._resetForm(this.patientOverlay);
					if (patientId) {
						this.commandService.executeCommand('ciyex.openPatientChart', patientId, `${fName} ${lName}`);
					}
				} else {
					const errData = await res.json().catch(() => ({}));
					errorEl.textContent = (errData as Record<string, string>).message || `Error: ${res.status}`;
					errorEl.style.display = '';
				}
			} catch (err) {
				errorEl.textContent = 'Failed to create patient. Please try again.';
				errorEl.style.display = '';
			}

			saveBtn.removeAttribute('disabled');
			saveBtn.textContent = 'Save';
		}));
	}

	// --- Appointment Creation Overlay ---

	private providers: ProviderResult[] = [];
	private locations: LocationResult[] = [];

	private _buildAppointmentOverlay(): void {
		this._ensureOverlayBackdrop();
		this.appointmentOverlay = DOM.$('.ehr-overlay.ehr-overlay-wide');
		this.appointmentOverlay.style.display = 'none';
		DOM.getActiveWindow().document.body.appendChild(this.appointmentOverlay);

		const header = DOM.append(this.appointmentOverlay, DOM.$('.ehr-overlay-header'));
		const title = DOM.append(header, DOM.$('h3'));
		title.textContent = 'Add Appointment';
		const closeBtn = DOM.append(header, DOM.$('.ehr-overlay-close'));
		closeBtn.textContent = '\u00D7';
		this._register(DOM.addDisposableListener(closeBtn, 'click', () => this._closeAppointmentOverlay()));
		this._makeDraggable(this.appointmentOverlay, header);

		const subtitle = DOM.append(this.appointmentOverlay, DOM.$('p.ehr-overlay-subtitle'));
		subtitle.textContent = 'Schedule or edit an appointment to stay on track';

		const form = DOM.append(this.appointmentOverlay, DOM.$('.ehr-overlay-form'));

		const errorEl = DOM.append(form, DOM.$('.ehr-form-error'));
		errorEl.style.display = 'none';
		this._appointmentFormElements.errorEl = errorEl;

		// Row 1: Visit Type, Patient
		const row1 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		const visitType = this._createSelectField(row1, 'Visit Type', false, 'visitType', [
			{ value: 'Consultation', label: 'Consultation' },
			{ value: 'Follow-Up', label: 'Follow-Up' },
			{ value: 'New Patient', label: 'New Patient' },
			{ value: 'Urgent', label: 'Urgent' },
			{ value: 'Routine', label: 'Routine' },
			{ value: 'Annual Physical', label: 'Annual Physical' },
			{ value: 'Telehealth', label: 'Telehealth' },
			{ value: 'Lab Work', label: 'Lab Work' },
			{ value: 'Procedure', label: 'Procedure' },
			{ value: 'Referral', label: 'Referral' },
		]);

		// Patient search field
		const patientGroup = DOM.append(row1, DOM.$('.ehr-form-group'));
		const patientLabelEl = DOM.append(patientGroup, DOM.$('label.ehr-form-label'));
		patientLabelEl.textContent = 'Patient';
		const reqBadge = DOM.append(patientLabelEl, DOM.$('span.ehr-required-badge'));
		reqBadge.textContent = 'required';

		const patientSearchContainer = DOM.append(patientGroup, DOM.$('.ehr-patient-search-container'));
		const patientSearchInput = DOM.append(patientSearchContainer, DOM.$('input.ehr-form-input')) as HTMLInputElement;
		patientSearchInput.placeholder = 'Search patient by name...';
		const patientDropdown = DOM.append(patientSearchContainer, DOM.$('.ehr-patient-dropdown'));
		patientDropdown.style.display = 'none';

		let selectedPatientId = '';
		let patientSearchTimer: ReturnType<typeof setTimeout> | undefined;

		const _fetchPatients = async (q: string) => {
			try {
				const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
				if (res.ok) {
					const data = await res.json();
					const patients: PatientResult[] = data?.data?.content || data?.content || [];
					DOM.clearNode(patientDropdown);
					for (const p of patients) {
						const item = DOM.append(patientDropdown, DOM.$('.ehr-search-item'));
						const nameEl = DOM.append(item, DOM.$('.ehr-search-name'));
						nameEl.textContent = `${p.firstName} ${p.lastName}`;
						const dobEl = DOM.append(item, DOM.$('.ehr-search-dob'));
						dobEl.textContent = p.dateOfBirth ? `DOB: ${this._formatDisplayDate(p.dateOfBirth)}` : '';
						this._register(DOM.addDisposableListener(item, 'click', () => {
							selectedPatientId = p.fhirId || p.id;
							patientSearchInput.value = `${p.firstName} ${p.lastName}`;
							patientDropdown.style.display = 'none';
						}));
					}
					patientDropdown.style.display = patients.length > 0 ? '' : 'none';
				}
			} catch { /* */ }
		};

		// Show dropdown immediately on focus (even with empty input)
		this._register(DOM.addDisposableListener(patientSearchInput, 'focus', () => {
			if (patientSearchTimer) { clearTimeout(patientSearchTimer); }
			patientSearchTimer = setTimeout(() => _fetchPatients(patientSearchInput.value.trim()), 150);
		}));

		this._register(DOM.addDisposableListener(patientSearchInput, 'input', () => {
			if (patientSearchTimer) { clearTimeout(patientSearchTimer); }
			selectedPatientId = '';
			const q = patientSearchInput.value.trim();
			patientSearchTimer = setTimeout(() => _fetchPatients(q), 250);
		}));

		// Row 2: Start Date, End Date
		const row2 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		const startDate = this._createField(row2, 'Start Date', 'date', false, 'startDate') as HTMLInputElement;
		const endDate = this._createField(row2, 'End Date', 'date', false, 'endDate') as HTMLInputElement;

		// When start date is picked, default end date to the same day
		this._register(DOM.addDisposableListener(startDate, 'change', () => {
			if (startDate.value && !endDate.value) {
				endDate.value = startDate.value;
				const endWrap = endDate.parentElement;
				if (endWrap) {
					// The visible text input is always the first child of the date wrap
					const vis = endWrap.firstElementChild as HTMLInputElement | null;
					if (vis && vis.type === 'text') {
						const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(startDate.value);
						if (m) { vis.value = `${m[2]}/${m[3]}/${m[1]}`; }
					}
				}
			}
		}));

		// Row 3: Start Time, End Time, Duration
		const row3 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-3'));
		const startTime = this._createField(row3, 'Start Time', 'time', false, 'startTime') as HTMLInputElement;
		const endTime = this._createField(row3, 'End Time', 'time', false, 'endTime') as HTMLInputElement;
		const durationGroup = DOM.append(row3, DOM.$('.ehr-form-group'));
		const durationLabel = DOM.append(durationGroup, DOM.$('label.ehr-form-label'));
		durationLabel.textContent = 'Duration';
		const durationDisplay = DOM.append(durationGroup, DOM.$('.ehr-duration-display'));
		durationDisplay.textContent = '\u2014';

		// Auto-calc duration
		const calcDuration = () => {
			const st = startTime.value;
			const et = endTime.value;
			if (st && et) {
				const [sh, sm] = st.split(':').map(Number);
				const [eh, em] = et.split(':').map(Number);
				const mins = (eh * 60 + em) - (sh * 60 + sm);
				durationDisplay.textContent = mins > 0 ? `${mins} min` : '\u2014';
			}
		};
		this._register(DOM.addDisposableListener(startTime, 'change', calcDuration));
		this._register(DOM.addDisposableListener(endTime, 'change', calcDuration));

		// Auto-set end time 15 min after start
		this._register(DOM.addDisposableListener(startTime, 'change', () => {
			const st = startTime.value;
			if (st && !endTime.value) {
				const [h, m] = st.split(':').map(Number);
				const totalMin = h * 60 + m + 15;
				const nh = Math.floor(totalMin / 60) % 24;
				const nm = totalMin % 60;
				endTime.value = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
				calcDuration();
			}
			// end date already synced by startDate change listener above
		}));

		// Row 4: Priority, Provider
		const row4 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		const priority = this._createSelectField(row4, 'Priority', false, 'priority', [
			{ value: 'Routine', label: 'Routine' },
			{ value: 'Urgent', label: 'Urgent' },
		]);

		const providerGroup = DOM.append(row4, DOM.$('.ehr-form-group'));
		const providerLabelEl = DOM.append(providerGroup, DOM.$('label.ehr-form-label'));
		providerLabelEl.textContent = 'Provider';
		const provReqBadge = DOM.append(providerLabelEl, DOM.$('span.ehr-required-badge'));
		provReqBadge.textContent = 'required';
		const providerSelect = DOM.append(providerGroup, DOM.$('select.ehr-form-select')) as HTMLSelectElement;
		const provDefaultOpt = DOM.append(providerSelect, DOM.$('option')) as HTMLOptionElement;
		provDefaultOpt.value = '';
		provDefaultOpt.textContent = 'Select a provider...';

		// Row 5: Location, Status
		const row5 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		const locationGroup = DOM.append(row5, DOM.$('.ehr-form-group'));
		const locationLabelEl = DOM.append(locationGroup, DOM.$('label.ehr-form-label'));
		locationLabelEl.textContent = 'Location';
		const locReqBadge = DOM.append(locationLabelEl, DOM.$('span.ehr-required-badge'));
		locReqBadge.textContent = 'required';
		const locationSelect = DOM.append(locationGroup, DOM.$('select.ehr-form-select')) as HTMLSelectElement;
		const locDefaultOpt = DOM.append(locationSelect, DOM.$('option')) as HTMLOptionElement;
		locDefaultOpt.value = '';
		locDefaultOpt.textContent = 'Select a location...';

		const status = this._createSelectField(row5, 'Status', false, 'status', [
			{ value: 'Scheduled', label: 'Scheduled' },
			{ value: 'Confirmed', label: 'Confirmed' },
			{ value: 'Checked-in', label: 'Checked-in' },
			{ value: 'Completed', label: 'Completed' },
			{ value: 'Re-Scheduled', label: 'Re-Scheduled' },
			{ value: 'No Show', label: 'No Show' },
			{ value: 'Cancelled', label: 'Cancelled' },
		]);

		// Row 6: Reason
		const row6 = DOM.append(form, DOM.$('.ehr-form-row'));
		const reasonGroup = DOM.append(row6, DOM.$('.ehr-form-group'));
		reasonGroup.style.flex = '1';
		const reasonLabel = DOM.append(reasonGroup, DOM.$('label.ehr-form-label'));
		reasonLabel.textContent = 'Reason / Chief Complaint';
		const reasonInput = DOM.append(reasonGroup, DOM.$('textarea.ehr-form-textarea')) as HTMLTextAreaElement;
		reasonInput.placeholder = 'e.g., chest discomfort for 2 days';
		reasonInput.rows = 3;

		// Buttons
		const btnRow = DOM.append(form, DOM.$('.ehr-form-buttons'));
		const cancelBtn = DOM.append(btnRow, DOM.$('button.ehr-btn-cancel'));
		cancelBtn.textContent = 'Cancel';
		this._register(DOM.addDisposableListener(cancelBtn, 'click', () => this._closeAppointmentOverlay()));

		const saveBtn = DOM.append(btnRow, DOM.$('button.ehr-btn-save'));
		saveBtn.textContent = 'Save Appointment';

		this._register(DOM.addDisposableListener(saveBtn, 'click', async () => {
			errorEl.style.display = 'none';

			if (!selectedPatientId) {
				errorEl.textContent = 'Please select a patient.';
				errorEl.style.display = '';
				return;
			}
			if (!providerSelect.value) {
				errorEl.textContent = 'Please select a provider.';
				errorEl.style.display = '';
				return;
			}
			if (!locationSelect.value) {
				errorEl.textContent = 'Please select a location.';
				errorEl.style.display = '';
				return;
			}

			const sd = startDate.value;
			const st = startTime.value || '00:00';
			const ed = endDate.value || sd;
			const et = endTime.value || st;

			const startISO = sd ? `${sd}T${st}:00` : '';
			const endISO = ed ? `${ed}T${et}:00` : '';

			const vtVal = (visitType as HTMLSelectElement).value;
			const body = {
				appointmentType: {
					coding: [{ system: 'http://ciyex.org/appointment-type', code: vtVal.toLowerCase().replace(/\s+/g, '-'), display: vtVal }],
					text: vtVal,
				},
				status: (status as HTMLSelectElement).value.toLowerCase(),
				priority: (priority as HTMLSelectElement).value.toLowerCase(),
				start: startISO,
				end: endISO,
				reason: reasonInput.value.trim(),
				patient: `Patient/${selectedPatientId}`,
				provider: `Practitioner/${providerSelect.value}`,
				location: `Location/${locationSelect.value}`,
				participant: [
					{ actor: `Patient/${selectedPatientId}`, required: 'required', status: 'accepted' },
					{ actor: `Practitioner/${providerSelect.value}`, required: 'required', status: 'accepted' },
					{ actor: `Location/${locationSelect.value}`, required: 'required', status: 'accepted' },
				],
			};

			saveBtn.setAttribute('disabled', 'true');
			saveBtn.textContent = 'Saving...';

			try {
				const res = await this.apiService.fetch(`/api/fhir-resource/appointments/patient/${selectedPatientId}`, {
					method: 'POST',
					body: JSON.stringify(body),
				});

				if (res.ok) {
					this.notificationService.notify({ severity: Severity.Info, message: 'Appointment created successfully.' });
					this._closeAppointmentOverlay();
					this._resetForm(this.appointmentOverlay);
					selectedPatientId = '';
					patientSearchInput.value = '';
					// Refresh calendar if open
					this.commandService.executeCommand('ciyex.openCalendar').catch(() => { });
				} else {
					const errData = await res.json().catch(() => ({}));
					errorEl.textContent = (errData as Record<string, string>).message || `Error: ${res.status}`;
					errorEl.style.display = '';
				}
			} catch {
				errorEl.textContent = 'Failed to create appointment. Please try again.';
				errorEl.style.display = '';
			}

			saveBtn.removeAttribute('disabled');
			saveBtn.textContent = 'Save Appointment';
		}));

		// Store references for populating and resetting later
		this._appointmentProviderSelect = providerSelect;
		this._appointmentLocationSelect = locationSelect;
		this._appointmentFormElements.inputs.push(patientSearchInput, startDate, endDate, startTime, endTime);
		this._appointmentFormElements.selects.push(visitType as HTMLSelectElement, priority as HTMLSelectElement, providerSelect, locationSelect, status as HTMLSelectElement);
		this._appointmentFormElements.textareas.push(reasonInput);
	}

	private _appointmentProviderSelect!: HTMLSelectElement;
	private _appointmentLocationSelect!: HTMLSelectElement;

	private async _loadProvidersAndLocations(): Promise<void> {
		// Providers
		if (this.providers.length === 0) {
			const providerUrls = ['/api/providers?status=ACTIVE&page=0&size=100', '/api/fhir-resource/providers?page=0&size=100'];
			for (const url of providerUrls) {
				try {
					const res = await this.apiService.fetch(url);
					if (res.ok) {
						const data = await res.json();
						const list = data?.data?.content || data?.content || [];
						if (list.length > 0) {
							this.providers = list;
							break;
						}
					}
				} catch { /* try next */ }
			}
		}

		// Locations
		if (this.locations.length === 0) {
			const locationUrls = ['/api/locations?page=0&size=100', '/api/fhir-resource/facilities?page=0&size=100'];
			for (const url of locationUrls) {
				try {
					const res = await this.apiService.fetch(url);
					if (res.ok) {
						const data = await res.json();
						const list = data?.data?.content || data?.content || [];
						if (list.length > 0) {
							this.locations = list;
							break;
						}
					}
				} catch { /* try next */ }
			}
		}

		// Populate provider select
		const pSelect = this._appointmentProviderSelect;
		while (pSelect.options.length > 1) { pSelect.remove(1); }
		for (const p of this.providers) {
			const opt = DOM.$('option') as HTMLOptionElement;
			opt.value = (p as ProviderResult).id || (p as ProviderResult).fhirId || '';
			const prefix = (p as ProviderResult)['identification.prefix'] || '';
			const fn = (p as ProviderResult)['identification.firstName'] || (p as ProviderResult).firstName || '';
			const ln = (p as ProviderResult)['identification.lastName'] || (p as ProviderResult).lastName || '';
			opt.textContent = `${prefix} ${fn} ${ln}`.trim() || (p as ProviderResult).name || (p as ProviderResult).fullName || (p as ProviderResult).username || '';
			pSelect.appendChild(opt);
		}

		// Populate location select
		const lSelect = this._appointmentLocationSelect;
		while (lSelect.options.length > 1) { lSelect.remove(1); }
		for (const l of this.locations) {
			const opt = DOM.$('option') as HTMLOptionElement;
			opt.value = l.id;
			opt.textContent = l.name;
			lSelect.appendChild(opt);
		}
	}

	// --- Overlay Toggle ---

	private _resetOverlayPosition(overlay: HTMLElement): void {
		overlay.style.transform = 'translate(-50%, -50%)';
		overlay.style.left = '50%';
		overlay.style.top = '50%';
	}

	// Lazily move overlays into .monaco-workbench so they inherit theme CSS variables.
	// The constructor runs before .monaco-workbench exists, so we do this on first open.
	private _ensureInWorkbench(el: HTMLElement): void {
		// Walk up from the titlebar controls element to find .monaco-workbench
		// without using fragile selector APIs.
		let wb: HTMLElement | null = this.element.parentElement;
		while (wb && !wb.classList.contains('monaco-workbench')) {
			wb = wb.parentElement;
		}
		if (wb && !wb.contains(el)) {
			wb.appendChild(el);
		}
	}

	private _togglePatientOverlay(): void {
		const isOpen = this.patientOverlay.style.display !== 'none';
		this._closeAllOverlays();
		if (!isOpen) {
			this._ensureInWorkbench(this.overlayBackdrop);
			this._ensureInWorkbench(this.patientOverlay);
			this._resetOverlayPosition(this.patientOverlay);
			this.patientOverlay.style.display = '';
			this._showBackdrop();
		}
	}

	private _toggleAppointmentOverlay(): void {
		const isOpen = this.appointmentOverlay.style.display !== 'none';
		this._closeAllOverlays();
		if (!isOpen) {
			this._ensureInWorkbench(this.overlayBackdrop);
			this._ensureInWorkbench(this.appointmentOverlay);
			this._resetOverlayPosition(this.appointmentOverlay);
			this.appointmentOverlay.style.display = '';
			this._showBackdrop();
			this._loadProvidersAndLocations();
		}
	}

	private _closePatientOverlay(): void {
		this.patientOverlay.style.display = 'none';
		this._hideBackdropIfIdle();
	}

	private _closeAppointmentOverlay(): void {
		this.appointmentOverlay.style.display = 'none';
		this._hideBackdropIfIdle();
	}

	private _closeAllOverlays(): void {
		this.searchDropdown.style.display = 'none';
		this.patientOverlay.style.display = 'none';
		this.appointmentOverlay.style.display = 'none';
		this._hideBackdropIfIdle();
	}

	private _showBackdrop(): void {
		if (this.overlayBackdrop) { this.overlayBackdrop.style.display = ''; }
	}

	private _hideBackdropIfIdle(): void {
		if (!this.overlayBackdrop) { return; }
		const patientOpen = this.patientOverlay && this.patientOverlay.style.display !== 'none';
		const apptOpen = this.appointmentOverlay && this.appointmentOverlay.style.display !== 'none';
		if (!patientOpen && !apptOpen) {
			this.overlayBackdrop.style.display = 'none';
		}
	}

	// --- Form Helpers ---

	private _createField(parent: HTMLElement, label: string, type: string, required: boolean, name: string): HTMLElement {
		const group = DOM.append(parent, DOM.$('.ehr-form-group'));
		const labelEl = DOM.append(group, DOM.$('label.ehr-form-label'));
		if (required) {
			const star = DOM.append(labelEl, DOM.$('span.ehr-required-star'));
			star.textContent = '*';
		}
		labelEl.append(` ${label}`);

		// Native <input type="date"> on Linux Chromium hardcodes a locale-driven
		// placeholder ("dd-mm-yyyy") that ignores the placeholder attribute,
		// which the test team flagged as wrong format. Render a text input
		// (mm/dd/yyyy) plus a hidden native date picker for the calendar pop-up;
		// the hidden ISO input is what code reads as `.value`.
		if (type === 'date') {
			const wrap = DOM.append(group, DOM.$('.ehr-date-wrap'));
			// Visible text input — padding-right handled by CSS .ehr-date-wrap > input[type="text"]
			const visible = DOM.append(wrap, DOM.$('input.ehr-form-input')) as HTMLInputElement;
			visible.type = 'text';
			visible.placeholder = 'MM/DD/YYYY';
			visible.maxLength = 10;
			// Hidden ISO value input
			const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			hidden.type = 'hidden';
			hidden.name = name;
			const isoToUs = (iso: string): string => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? `${m[2]}/${m[3]}/${m[1]}` : ''; };
			const usToIso = (us: string): string => { const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(us); if (!m) { return ''; } return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; };
			// Native date picker overlays the calendar icon area (right 30 px) —
			// opacity:0 but fully clickable so a direct user click opens the native
			// calendar without needing showPicker() (which is unreliable in Electron).
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			visible.addEventListener('input', () => {
				const iso = usToIso(visible.value);
				hidden.value = iso;
				visible.style.borderColor = visible.value && !iso ? '#ef4444' : '';
				if (iso) { hidden.dispatchEvent(new Event('change', { bubbles: false })); }
			});
			picker.addEventListener('change', () => {
				visible.value = isoToUs(picker.value);
				hidden.value = picker.value;
				visible.dispatchEvent(new Event('input'));
				hidden.dispatchEvent(new Event('change', { bubbles: false }));
			});
			// Calendar emoji icon — visual only (pointer-events:none); clicks go through to the picker overlay above
			const icon = DOM.append(wrap, DOM.$('span'));
			icon.textContent = '\u{1F4C5}';
			icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:13px;pointer-events:none;line-height:1;';
			return hidden;
		}

		const input = DOM.append(group, DOM.$(`input.ehr-form-input`)) as HTMLInputElement;
		input.type = type;
		input.name = name;
		if (type === 'tel') { input.placeholder = '(555) 123-4567'; }
		if (type === 'email') { input.placeholder = 'name@example.com'; }
		return input;
	}

	private _createSelectField(parent: HTMLElement, label: string, required: boolean, name: string, options: Array<{ value: string; label: string }>): HTMLElement {
		const group = DOM.append(parent, DOM.$('.ehr-form-group'));
		const labelEl = DOM.append(group, DOM.$('label.ehr-form-label'));
		if (required) {
			const star = DOM.append(labelEl, DOM.$('span.ehr-required-star'));
			star.textContent = '*';
		}
		labelEl.append(` ${label}`);

		const select = DOM.append(group, DOM.$('select.ehr-form-select')) as HTMLSelectElement;
		select.name = name;
		for (const opt of options) {
			const optEl = DOM.append(select, DOM.$('option')) as HTMLOptionElement;
			optEl.value = opt.value;
			optEl.textContent = opt.label;
		}
		return select;
	}

	private _createCheckbox(parent: HTMLElement, label: string, checked: boolean): HTMLElement {
		const wrapper = DOM.append(parent, DOM.$('.ehr-checkbox-wrapper'));
		const input = DOM.append(wrapper, DOM.$('input')) as HTMLInputElement;
		input.type = 'checkbox';
		input.checked = checked;
		const labelEl = DOM.append(wrapper, DOM.$('label'));
		labelEl.textContent = label;
		return input;
	}

	private readonly _patientFormElements: { inputs: HTMLInputElement[]; selects: HTMLSelectElement[]; textareas: HTMLTextAreaElement[]; errorEl: HTMLElement | null } = { inputs: [], selects: [], textareas: [], errorEl: null };
	private readonly _appointmentFormElements: { inputs: HTMLInputElement[]; selects: HTMLSelectElement[]; textareas: HTMLTextAreaElement[]; errorEl: HTMLElement | null } = { inputs: [], selects: [], textareas: [], errorEl: null };

	private _resetForm(form: HTMLElement): void {
		const elements = form === this.patientOverlay ? this._patientFormElements : this._appointmentFormElements;
		for (const el of elements.inputs) {
			if (el.type === 'checkbox') { el.checked = true; }
			else { el.value = ''; }
		}
		for (const el of elements.selects) {
			el.selectedIndex = 0;
		}
		for (const el of elements.textareas) {
			el.value = '';
		}
		if (elements.errorEl) { elements.errorEl.style.display = 'none'; }
	}

	private _makeDraggable(overlay: HTMLElement, handle: HTMLElement): void {
		let dragging = false;
		let startX = 0, startY = 0, origLeft = 0, origTop = 0;

		const onMouseMove = (e: MouseEvent) => {
			if (!dragging) { return; }
			const targetWindow = DOM.getActiveWindow();
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			const newLeft = Math.max(0, Math.min(origLeft + dx, targetWindow.innerWidth - overlay.offsetWidth));
			const newTop = Math.max(0, Math.min(origTop + dy, targetWindow.innerHeight - overlay.offsetHeight));
			overlay.style.left = `${newLeft}px`;
			overlay.style.top = `${newTop}px`;
		};

		const onMouseUp = () => {
			if (!dragging) { return; }
			dragging = false;
			handle.style.cursor = 'grab';
			overlay.style.userSelect = '';
			DOM.getActiveWindow().removeEventListener('mousemove', onMouseMove);
			DOM.getActiveWindow().removeEventListener('mouseup', onMouseUp);
		};

		this._register(DOM.addDisposableListener(handle, 'mousedown', (e: MouseEvent) => {
			if ((e.target as HTMLElement).closest('.ehr-overlay-close')) { return; }
			// Resolve current position — first drag converts from transform-center to explicit px
			const rect = overlay.getBoundingClientRect();
			overlay.style.transform = 'none';
			overlay.style.left = `${rect.left}px`;
			overlay.style.top = `${rect.top}px`;

			dragging = true;
			startX = e.clientX;
			startY = e.clientY;
			origLeft = rect.left;
			origTop = rect.top;
			handle.style.cursor = 'grabbing';
			overlay.style.userSelect = 'none';
			DOM.getActiveWindow().addEventListener('mousemove', onMouseMove);
			DOM.getActiveWindow().addEventListener('mouseup', onMouseUp);
			e.preventDefault();
		}));

		handle.style.cursor = 'grab';
	}

	private _formatDisplayDate(dateStr: string): string {
		if (!dateStr) { return ''; }
		// Use string splitting for ISO date-only values (YYYY-MM-DD) to avoid the
		// UTC-midnight timezone shift that new Date("YYYY-MM-DD") causes.
		const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
		if (iso) { return `${iso[2]}/${iso[3]}/${iso[1]}`; }
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) { return dateStr; }
		return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
	}

	override dispose(): void {
		this.patientOverlay?.remove();
		this.appointmentOverlay?.remove();
		this.searchDropdown?.remove();
		this.searchElement?.remove();
		super.dispose();
	}
}
