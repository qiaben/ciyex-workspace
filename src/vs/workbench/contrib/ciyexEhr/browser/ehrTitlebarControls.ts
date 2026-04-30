/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import * as DOM from '../../../../base/browser/dom.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
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

	readonly element: HTMLElement;

	private searchInput!: HTMLInputElement;
	private searchDropdown!: HTMLElement;
	private patientOverlay!: HTMLElement;
	private appointmentOverlay!: HTMLElement;

	private searchCts: CancellationTokenSource | undefined;
	private searchTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly apiService: ICiyexApiService,
		private readonly commandService: ICommandService,
		private readonly notificationService: INotificationService,
	) {
		super();

		this.element = DOM.$('.ehr-titlebar-controls');
		this._buildSearchBar();
		this._buildAddPatientButton();
		this._buildAddAppointmentButton();
		this._buildPatientOverlay();
		this._buildAppointmentOverlay();

		// Close overlays on outside click
		this._register(DOM.addDisposableListener(DOM.getActiveWindow().document, DOM.EventType.MOUSE_DOWN, (e) => {
			if (!this.element.contains(e.target as Node) &&
				!this.patientOverlay.contains(e.target as Node) &&
				!this.appointmentOverlay.contains(e.target as Node)) {
				this._closeAllOverlays();
			}
		}));
	}

	// --- Search Bar ---

	private _buildSearchBar(): void {
		const searchContainer = DOM.append(this.element, DOM.$('.ehr-search-container'));

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

		this.searchDropdown = DOM.append(searchContainer, DOM.$('.ehr-search-dropdown'));
		this.searchDropdown.style.display = 'none';

		this._register(DOM.addDisposableListener(this.searchInput, 'input', () => this._onSearchInput()));
		this._register(DOM.addDisposableListener(this.searchInput, 'focus', () => {
			if (this.searchInput.value.trim().length > 0) {
				this.searchDropdown.style.display = '';
			}
		}));
		this._register(DOM.addDisposableListener(this.searchInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.searchInput.blur();
				this.searchDropdown.style.display = 'none';
			}
		}));
	}

	private _onSearchInput(): void {
		if (this.searchTimer) { clearTimeout(this.searchTimer); }
		if (this.searchCts) { this.searchCts.cancel(); }

		const value = this.searchInput.value.trim();
		if (!value) {
			this.searchDropdown.style.display = 'none';
			DOM.clearNode(this.searchDropdown);
			return;
		}

		this.searchTimer = setTimeout(async () => {
			this.searchCts = new CancellationTokenSource();
			try {
				const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(value)}&page=0&size=10`);
				if (this.searchCts.token.isCancellationRequested) { return; }
				if (res.ok) {
					const data = await res.json();
					const patients: PatientResult[] = data?.data?.content || data?.content || [];
					this._renderSearchResults(patients);
				}
			} catch {
				// ignore
			}
		}, 300);
	}

	private _renderSearchResults(patients: PatientResult[]): void {
		DOM.clearNode(this.searchDropdown);

		if (patients.length === 0) {
			const empty = DOM.append(this.searchDropdown, DOM.$('.ehr-search-empty'));
			empty.textContent = 'No patients found';
			this.searchDropdown.style.display = '';
			return;
		}

		for (const p of patients) {
			const item = DOM.append(this.searchDropdown, DOM.$('.ehr-search-item'));
			const nameEl = DOM.append(item, DOM.$('.ehr-search-name'));
			nameEl.textContent = `${p.firstName} ${p.lastName}`;
			const dobEl = DOM.append(item, DOM.$('.ehr-search-dob'));
			dobEl.textContent = p.dateOfBirth ? `DOB: ${this._formatDisplayDate(p.dateOfBirth)}` : '';

			this._register(DOM.addDisposableListener(item, 'click', () => {
				const patientId = p.fhirId || p.id;
				this.commandService.executeCommand('ciyex.openPatientChart', patientId, `${p.firstName} ${p.lastName}`);
				this.searchDropdown.style.display = 'none';
				this.searchInput.value = '';
			}));
		}
		this.searchDropdown.style.display = '';
	}

	// --- Add Patient Button ---

	private _buildAddPatientButton(): void {
		const btn = DOM.append(this.element, DOM.$('.ehr-action-btn'));
		btn.title = 'Add Patient';
		btn.setAttribute('aria-label', 'Add Patient');

		const plusIcon = DOM.append(btn, DOM.$('span'));
		plusIcon.textContent = '+';
		plusIcon.style.cssText = 'font-size:11px;font-weight:700;';

		DOM.append(btn, DOM.$('span.codicon.codicon-person'));

		this._register(DOM.addDisposableListener(btn, 'click', (e) => {
			e.stopPropagation();
			this._togglePatientOverlay();
		}));
	}

	// --- Add Appointment Button ---

	private _buildAddAppointmentButton(): void {
		const btn = DOM.append(this.element, DOM.$('.ehr-action-btn'));
		btn.title = 'Add Appointment';
		btn.setAttribute('aria-label', 'Add Appointment');

		const plusIcon = DOM.append(btn, DOM.$('span'));
		plusIcon.textContent = '+';
		plusIcon.style.cssText = 'font-size:11px;font-weight:700;';

		DOM.append(btn, DOM.$('span.codicon.codicon-calendar'));

		this._register(DOM.addDisposableListener(btn, 'click', (e) => {
			e.stopPropagation();
			this._toggleAppointmentOverlay();
		}));
	}

	// --- Patient Creation Overlay ---

	private _buildPatientOverlay(): void {
		this.patientOverlay = DOM.$('.ehr-overlay');
		this.patientOverlay.style.display = 'none';
		DOM.getActiveWindow().document.body.appendChild(this.patientOverlay);

		const header = DOM.append(this.patientOverlay, DOM.$('.ehr-overlay-header'));
		const title = DOM.append(header, DOM.$('h3'));
		title.textContent = 'Create Patient';
		const closeBtn = DOM.append(header, DOM.$('.ehr-overlay-close'));
		closeBtn.textContent = '\u00D7';
		this._register(DOM.addDisposableListener(closeBtn, 'click', () => this._closePatientOverlay()));

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
		dobWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const dobVisible = DOM.append(dobWrap, DOM.$('input.ehr-form-input')) as HTMLInputElement;
		dobVisible.type = 'text';
		dobVisible.placeholder = 'mm/dd/yyyy';
		dobVisible.maxLength = 10;
		dobVisible.style.flex = '1';
		const dob = DOM.append(dobWrap, DOM.$('input')) as HTMLInputElement;
		dob.type = 'hidden';
		dob.name = 'dateOfBirth';
		const dobPicker = DOM.append(dobWrap, DOM.$('input')) as HTMLInputElement;
		dobPicker.type = 'date';
		dobPicker.max = todayIso;
		dobPicker.style.cssText = 'width:28px;height:32px;padding:0;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;background:var(--vscode-input-background);cursor:pointer;color-scheme:dark light;';
		dobPicker.title = 'Open calendar';
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
			dob.value = iso && iso <= todayIso ? iso : (iso > todayIso ? todayIso : '');
			dobVisible.style.borderColor = dobVisible.value && !iso ? '#ef4444' : '';
		}));
		this._register(DOM.addDisposableListener(dobPicker, 'change', () => {
			const v = dobPicker.value > todayIso ? todayIso : dobPicker.value;
			dob.value = v;
			dobVisible.value = isoToUs(v);
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
		this.appointmentOverlay = DOM.$('.ehr-overlay.ehr-overlay-wide');
		this.appointmentOverlay.style.display = 'none';
		DOM.getActiveWindow().document.body.appendChild(this.appointmentOverlay);

		const header = DOM.append(this.appointmentOverlay, DOM.$('.ehr-overlay-header'));
		const title = DOM.append(header, DOM.$('h3'));
		title.textContent = 'Add Appointment';
		const closeBtn = DOM.append(header, DOM.$('.ehr-overlay-close'));
		closeBtn.textContent = '\u00D7';
		this._register(DOM.addDisposableListener(closeBtn, 'click', () => this._closeAppointmentOverlay()));

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
			{ value: 'Annual Physical', label: 'Annual Physical' },
			{ value: 'Sick Visit', label: 'Sick Visit' },
			{ value: 'Telehealth', label: 'Telehealth' },
			{ value: 'Lab Work', label: 'Lab Work' },
			{ value: 'Procedure', label: 'Procedure' },
			{ value: 'Routine', label: 'Routine' },
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

		this._register(DOM.addDisposableListener(patientSearchInput, 'input', () => {
			if (patientSearchTimer) { clearTimeout(patientSearchTimer); }
			selectedPatientId = '';
			const q = patientSearchInput.value.trim();
			if (q.length < 2) { patientDropdown.style.display = 'none'; return; }

			patientSearchTimer = setTimeout(async () => {
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
			}, 250);
		}));

		// Row 2: Start Date, End Date
		const row2 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		const startDate = this._createField(row2, 'Start Date', 'date', false, 'startDate') as HTMLInputElement;
		const endDate = this._createField(row2, 'End Date', 'date', false, 'endDate') as HTMLInputElement;

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
			// Sync start date to end date
			if (startDate.value && !endDate.value) {
				endDate.value = startDate.value;
			}
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

	private _togglePatientOverlay(): void {
		const isOpen = this.patientOverlay.style.display !== 'none';
		this._closeAllOverlays();
		if (!isOpen) {
			this.patientOverlay.style.display = '';
			this._positionOverlay(this.patientOverlay);
		}
	}

	private _toggleAppointmentOverlay(): void {
		const isOpen = this.appointmentOverlay.style.display !== 'none';
		this._closeAllOverlays();
		if (!isOpen) {
			this.appointmentOverlay.style.display = '';
			this._positionOverlay(this.appointmentOverlay);
			this._loadProvidersAndLocations();
		}
	}

	private _closePatientOverlay(): void {
		this.patientOverlay.style.display = 'none';
	}

	private _closeAppointmentOverlay(): void {
		this.appointmentOverlay.style.display = 'none';
	}

	private _closeAllOverlays(): void {
		this.searchDropdown.style.display = 'none';
		this.patientOverlay.style.display = 'none';
		this.appointmentOverlay.style.display = 'none';
	}

	private _positionOverlay(overlay: HTMLElement): void {
		const rect = this.element.getBoundingClientRect();
		overlay.style.top = `${rect.bottom}px`;
		const win = DOM.getActiveWindow();
		overlay.style.right = `${win.innerWidth - rect.right}px`;
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

		const input = DOM.append(group, DOM.$(`input.ehr-form-input`)) as HTMLInputElement;
		input.type = type;
		input.name = name;
		if (type === 'tel') { input.placeholder = '(555) 123-4567'; }
		if (type === 'email') { input.placeholder = 'name@example.com'; }
		if (type === 'date') { input.placeholder = 'MM/DD/YYYY'; }
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

	private _formatDisplayDate(dateStr: string): string {
		if (!dateStr) { return ''; }
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) { return dateStr; }
		return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
	}

	override dispose(): void {
		this.patientOverlay?.remove();
		this.appointmentOverlay?.remove();
		super.dispose();
	}
}
