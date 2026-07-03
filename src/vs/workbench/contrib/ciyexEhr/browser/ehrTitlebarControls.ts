/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import * as DOM from '../../../../base/browser/dom.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { createCustomDropdown, createTimeDropdown, IDropdownOption } from './customDropdown.js';
import { enablePickerClick, maskUsDate, usToIsoDate } from './ciyexDateMask.js';

interface PatientResult {
	id: string;
	fhirId?: string;
	firstName: string;
	middleName?: string;
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
		private readonly authService: ICiyexAuthService,
	) {
		super();

		// Drop the cached provider/location lists whenever the signed-in identity
		// changes (e.g. after creating a new practice via signup, which switches
		// the tenant). Without this the appointment form keeps showing the
		// previous practice's providers because _loadProvidersAndLocations only
		// fetches when the cache is empty.
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.Authenticated || state === CiyexAuthState.NotAuthenticated) {
				this.providers = [];
				this.locations = [];
				this._providerOptions.length = 0;
				this._locationOptions.length = 0;
			}
		}));

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
		searchIcon.classList.add('codicon');
		searchIcon.classList.add('codicon-search');

		this.searchInput = DOM.append(searchContainer, DOM.$('input.ehr-search-input')) as HTMLInputElement;
		this.searchInput.type = 'text';
		this.searchInput.placeholder = 'Search by name or DOB (MM/DD/YYYY)...';
		this.searchInput.setAttribute('aria-label', 'Search patients');

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
		// Dismiss the results panel when focus leaves the search box so it does
		// not linger under the bar. The short delay lets a click on a result
		// item register before the dropdown hides.
		this._register(DOM.addDisposableListener(this.searchInput, 'blur', () => {
			setTimeout(() => { this.searchDropdown.style.display = 'none'; }, 150);
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

		// Empty query: show only the search bar. Leaving the results panel open
		// here rendered a stray "No matches" box stuck under the bar (it looked
		// like a second, mismatched layout). Hide it until the user types.
		if (!value) {
			DOM.clearNode(this.searchDropdown);
			this.searchDropdown.style.display = 'none';
			return;
		}

		this._ensureInWorkbench(this.searchDropdown);
		DOM.clearNode(this.searchDropdown);
		const loading = DOM.append(this.searchDropdown, DOM.$('.ehr-search-empty'));
		loading.textContent = `Searching for "${value}"…`;
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
			const first = (p.firstName || p['identification.firstName'] || '').toLowerCase();
			const last = (p.lastName || p['identification.lastName'] || '').toLowerCase();
			const name = (p.name || p.fullName || `${first} ${last}`.trim() || p.username || '').toLowerCase();
			// Anchor at the start of a name token — typing "Abi" should match
			// "Abigail Walker" but NOT "Gabriel Cook" (test team report).
			return first.startsWith(q) || last.startsWith(q) || name.split(/\s+/).some(part => part.startsWith(q));
		});
	}

	private _clientFilterPatients(rows: PatientResult[], rawQuery: string): PatientResult[] {
		const q = rawQuery.toLowerCase();
		const usDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(rawQuery);
		const isoFromUs = usDate ? `${usDate[3]}-${usDate[1].padStart(2, '0')}-${usDate[2].padStart(2, '0')}` : '';
		return rows.filter(p => {
			const first = (p.firstName || '').toLowerCase();
			const last = (p.lastName || '').toLowerCase();
			const middle = (p.middleName || '').toLowerCase();
			// Anchor at the start of each name token: typing "Abi" matches
			// "Abi Test" and "Abigail Walker" but NOT "Gabriel" / "Isabella"
			// (those used to leak in because of substring includes()).
			if (first.startsWith(q) || last.startsWith(q) || (middle && middle.startsWith(q))) { return true; }
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
				const patientId = String(p.id || p.fhirId || '');
				this._register(DOM.addDisposableListener(item, 'click', () => {
					this.searchDropdown.style.display = 'none';
					this.searchInput.value = '';
					// Redirect to the patient's chart/snapshot (QA issue 29:
					// "search is working but it will not redirect to the
					// particular patient"). Fall back to the calendar only when the
					// result has no resolvable id.
					if (patientId) {
						this.commandService.executeCommand('ciyex.openPatientChart', patientId, patientName).catch(() => { });
					} else {
						this.searchInput.value = patientName;
						this.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
						this.commandService.executeCommand('ciyex.openCalendar').catch(() => { });
					}
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

		DOM.append(btn, DOM.$('span.ehr-patient-icon'));

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

		DOM.append(btn, DOM.$('span.codicon.codicon-heart'));

		this._register(DOM.addDisposableListener(btn, 'click', (e) => {
			e.stopPropagation();
			// Open the donation form in a new in-app tab via the Simple Browser.
			this.commandService.executeCommand('simpleBrowser.show', 'https://www.zeffy.com/en-US/donation-form/ciyex-ehr');
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
		const titleGroup = DOM.append(header, DOM.$('.ehr-overlay-title-group'));
		DOM.append(titleGroup, DOM.$('span.ehr-patient-icon.ehr-overlay-title-icon'));
		const title = DOM.append(titleGroup, DOM.$('h3'));
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
		// US phone: auto-format into `(555) 123-4567` and hard-cap at 10 digits.
		// Letters and over-length input are rejected as the user types/pastes
		// (QA: new patient phone accepted letters and >10 digits).
		phone.setAttribute('inputmode', 'tel');
		phone.setAttribute('autocomplete', 'tel');
		phone.maxLength = 16;
		phone.placeholder = '(555) 123-4567';
		const sanitizePhone = () => {
			let digits = phone.value.replace(/\D/g, '');
			if (digits.length === 11 && digits.startsWith('1')) { digits = digits.slice(1); }
			digits = digits.slice(0, 10);
			let formatted = '';
			if (digits.length === 0) { formatted = ''; }
			else if (digits.length <= 3) { formatted = `(${digits}`; }
			else if (digits.length <= 6) { formatted = `(${digits.slice(0, 3)}) ${digits.slice(3)}`; }
			else { formatted = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`; }
			if (phone.value !== formatted) { phone.value = formatted; }
		};
		this._register(DOM.addDisposableListener(phone, 'input', sanitizePhone));
		this._register(DOM.addDisposableListener(phone, 'paste', () => setTimeout(sanitizePhone, 0)));
		const gender = this._createSelectField(row2, 'Gender', true, 'gender', [
			{ value: '', label: 'Select gender' },
			{ value: 'male', label: 'Male' },
			{ value: 'female', label: 'Female' },
			{ value: 'unknown', label: 'Unknown' },
		]);

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
		const dobIcon = DOM.append(dobWrap, DOM.$('span.codicon.codicon-calendar'));
		dobIcon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--vscode-descriptionForeground);cursor:pointer;line-height:1;';
		// Open the calendar from a click anywhere in the icon column, not just the
		// native input's tiny indicator glyph.
		enablePickerClick(dobPicker, dobIcon);
		// usToIsoDate validates real calendar dates (rejects 13/33/2000), so an
		// impossible DOB leaves the hidden value empty and fails the required check
		// below instead of saving "2000-13-33".
		const usToIso = (us: string): string => usToIsoDate(us);
		const isoToUs = (iso: string): string => {
			const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
			return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
		};
		this._register(DOM.addDisposableListener(dobVisible, 'input', () => {
			// Auto-insert slashes and cap the year at 4 digits as the user types.
			const masked = maskUsDate(dobVisible.value);
			if (masked !== dobVisible.value) { dobVisible.value = masked; }
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
		// Open the native calendar on ANY click in the icon overlay. The bare date
		// input only pops the picker when the click lands exactly on its tiny
		// indicator glyph, so a click a few px off (over the text area / emoji) just
		// focused the field and nothing opened — the reported "icon sometimes
		// doesn't open the calendar". showPicker() makes the whole 30px hot-zone
		// open it; we still keep the input so its native indicator keeps working.
		this._register(DOM.addDisposableListener(dobPicker, 'click', () => {
			try { dobPicker.showPicker?.(); } catch { /* already open / not allowed in this context */ }
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

		// Track the visible text field and the native date picker too so _resetForm
		// clears them. Only the hidden ISO `dob` was tracked before, leaving the
		// previously entered date displayed when re-opening the form for a new patient.
		this._patientFormElements.inputs.push(firstName, middleName, lastName, phone, dob, dobVisible, dobPicker, email, emailConsent, smsConsent, voicemailConsent);
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
			this._clearPatientFieldErrors();

			const fName = firstName.value.trim();
			const mName = middleName.value.trim();
			const lName = lastName.value.trim();
			const phoneVal = phone.value.trim();
			const genderVal = gender.value;
			const emailVal = email.value.trim();
			const phoneDigits = phoneVal.replace(/\D/g, '');
			// Recompute the DOB from the visible field so a valid-but-future date
			// (which the input handler deliberately keeps out of the hidden ISO
			// value) is still detected here and reported as a future-date error
			// rather than as a generic "required"/"invalid" message.
			const dobIso = usToIso(dobVisible.value.trim());

			// Per-field inline validation — collect EVERY invalid field (don't stop
			// at the first) so the user sees all errors at once under each field, and
			// block submission until they are all cleared. Email regex is RFC
			// 5322-ish: local@domain.tld with at least one dot in the domain.
			const emailRe = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
			// Names: must start with a letter, then letters plus optional spaces,
			// dots, hyphens and apostrophes (e.g. "Anne-Marie", "O'Brien", "St. John").
			// Digits anywhere are rejected so numeric input fails validation.
			const nameRe = /^[A-Za-z][A-Za-z.\-'\s]*$/;
			const NAME_MSG = 'Letters only';
			let firstInvalid: HTMLElement | null = null;
			const fail = (field: HTMLElement, message: string) => {
				this._setFieldError(field, message);
				if (!firstInvalid) { firstInvalid = field; }
			};

			if (!fName) { fail(firstName, 'Required'); }
			else if (!nameRe.test(fName)) { fail(firstName, NAME_MSG); }
			if (mName && !nameRe.test(mName)) { fail(middleName, NAME_MSG); }
			if (!lName) { fail(lastName, 'Required'); }
			else if (!nameRe.test(lName)) { fail(lastName, NAME_MSG); }
			if (!phoneVal) { fail(phone, 'Required'); }
			// US format: a complete number is exactly 10 digits. A partial entry
			// (e.g. 5 digits) is rejected so an incomplete phone can't be saved.
			else if (phoneDigits.length !== 10) { fail(phone, 'Enter a 10-digit number'); }
			if (!genderVal) { fail(gender, 'Required'); }
			if (!dobVisible.value.trim()) { fail(dobVisible, 'Required'); }
			else if (!dobIso) { fail(dobVisible, 'Invalid date'); }
			else if (dobIso > todayIso) { fail(dobVisible, 'Cannot be in the future'); }
			if (!emailVal) { fail(email, 'Required'); }
			else if (!emailRe.test(emailVal)) { fail(email, 'Invalid email format'); }

			if (firstInvalid) {
				const invalidEl = firstInvalid as HTMLElement;
				invalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
				if (typeof invalidEl.focus === 'function') { invalidEl.focus(); }
				return;
			}

			const dobVal = dobIso;

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
					// Refresh the Patients list pane so the new patient appears without
					// a manual reload (the pane caches its roster and, for a brand-new
					// practice, would otherwise stay on its empty result).
					this.commandService.executeCommand('ciyex.refreshPatients').catch(() => { /* list may not be open */ });
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

		// Block past dates at the calendar level (mirrors ciyex-ehr-ui AppointmentModal).
		// `min` is (re)applied on overlay open via _refreshAppointmentDateMin so it stays
		// correct across a day boundary while the workbench stays running. In _createField's
		// date wrap the children are [visible-text, hidden, picker, icon], so the native date
		// picker is the hidden input's next sibling.
		const startPickerSib = startDate.nextElementSibling;
		const endPickerSib = endDate.nextElementSibling;
		this._appointmentStartDatePicker = DOM.isHTMLInputElement(startPickerSib) && startPickerSib.type === 'date' ? startPickerSib : null;
		this._appointmentEndDatePicker = DOM.isHTMLInputElement(endPickerSib) && endPickerSib.type === 'date' ? endPickerSib : null;
		this._refreshAppointmentDateMin();

		// When start date is picked, default end date to the same day
		this._register(DOM.addDisposableListener(startDate, 'change', () => {
			// End date can never precede the chosen start date.
			if (this._appointmentEndDatePicker && startDate.value) {
				this._appointmentEndDatePicker.min = startDate.value;
			}
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

		// Track the chosen appointment length so changing the start time keeps
		// the same duration instead of leaving the end time frozen.
		let durationMin = 15;

		// Auto-calc duration
		const calcDuration = () => {
			const st = startTime.value;
			const et = endTime.value;
			if (st && et) {
				const [sh, sm] = st.split(':').map(Number);
				const [eh, em] = et.split(':').map(Number);
				const mins = (eh * 60 + em) - (sh * 60 + sm);
				durationDisplay.textContent = mins > 0 ? `${mins} min` : '\u2014';
				if (mins > 0) { durationMin = mins; }
			}
		};
		// When the user edits the end time directly, treat it as a new duration.
		this._register(DOM.addDisposableListener(endTime, 'change', calcDuration));

		// Whenever the start time changes, shift the end time so the existing
		// duration is preserved (default 15 min the first time). Previously this
		// only ran when the end time was still empty, so a second change to the
		// start time left the end time unchanged.
		this._register(DOM.addDisposableListener(startTime, 'change', () => {
			const st = startTime.value;
			if (st) {
				const [h, m] = st.split(':').map(Number);
				const totalMin = h * 60 + m + durationMin;
				const nh = Math.floor(totalMin / 60) % 24;
				const nm = totalMin % 60;
				endTime.value = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
				durationDisplay.textContent = `${durationMin} min`;
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
		// Options are populated later by _loadProvidersAndLocations, which mutates
		// this array in place; the custom dropdown re-reads it each time it opens.
		const providerSelect = createCustomDropdown({
			parent: providerGroup,
			options: this._providerOptions,
			placeholder: 'Select a provider...',
			required: true,
			triggerStyle: EhrTitlebarControls._dropdownTriggerStyle,
		});

		// Row 5: Location, Status
		const row5 = DOM.append(form, DOM.$('.ehr-form-row.ehr-form-row-2'));
		const locationGroup = DOM.append(row5, DOM.$('.ehr-form-group'));
		const locationLabelEl = DOM.append(locationGroup, DOM.$('label.ehr-form-label'));
		locationLabelEl.textContent = 'Location';
		const locReqBadge = DOM.append(locationLabelEl, DOM.$('span.ehr-required-badge'));
		locReqBadge.textContent = 'required';
		const locationSelect = createCustomDropdown({
			parent: locationGroup,
			options: this._locationOptions,
			placeholder: 'Select a location...',
			required: true,
			triggerStyle: EhrTitlebarControls._dropdownTriggerStyle,
		});

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

			// Reject typed-but-invalid dates (e.g. 13/33/2000) before anything else —
			// the hidden ISO is empty and dataset.invalid is set when the visible
			// MM/DD/YYYY text isn't a real calendar date. Without this the empty ISO
			// reads as "no date" and the appointment saved with a blank start/end.
			if (startDate.dataset.invalid === '1' || endDate.dataset.invalid === '1') {
				errorEl.textContent = 'Please enter a valid date (MM/DD/YYYY).';
				errorEl.style.display = '';
				return;
			}

			const sd = startDate.value;
			const st = startTime.value || '00:00';
			const ed = endDate.value || sd;
			const et = endTime.value || st;

			// A start date is required to schedule — block a dateless save so an
			// appointment can't be created with an empty start (which is what an
			// invalid date previously collapsed to).
			if (!sd) {
				errorEl.textContent = 'Please enter a valid Start Date (MM/DD/YYYY).';
				errorEl.style.display = '';
				return;
			}

			// Past date/time guard — cannot schedule in the past; if today is chosen
			// the start time must not be earlier than now.
			if (sd) {
				const apptStart = new Date(`${sd}T${st}:00`);
				if (!isNaN(apptStart.getTime()) && apptStart.getTime() < Date.now()) {
					errorEl.textContent = 'Cannot create appointments in the past. Please select a future date and time.';
					errorEl.style.display = '';
					return;
				}
			}
			if (sd && ed && ed < sd) {
				errorEl.textContent = 'End date cannot be before start date.';
				errorEl.style.display = '';
				return;
			}

			const startISO = sd ? `${sd}T${st}:00` : '';
			const endISO = ed ? `${ed}T${et}:00` : '';

			const vtVal = visitType.value;
			const body = {
				appointmentType: {
					coding: [{ system: 'http://ciyex.org/appointment-type', code: vtVal.toLowerCase().replace(/\s+/g, '-'), display: vtVal }],
					text: vtVal,
				},
				status: status.value.toLowerCase(),
				priority: priority.value.toLowerCase(),
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

		// Store references for resetting later (provider/location options are
		// populated via _loadProvidersAndLocations into _providerOptions/_locationOptions).
		this._appointmentFormElements.inputs.push(patientSearchInput, startDate, endDate, startTime, endTime);
		this._appointmentFormElements.selects.push(visitType, priority, providerSelect, locationSelect, status);
		this._appointmentFormElements.textareas.push(reasonInput);
	}

	/** Live option arrays for the provider/location custom dropdowns — mutated in place by _loadProvidersAndLocations. */
	private readonly _providerOptions: IDropdownOption[] = [];
	private readonly _locationOptions: IDropdownOption[] = [];
	private _appointmentStartDatePicker: HTMLInputElement | null = null;
	private _appointmentEndDatePicker: HTMLInputElement | null = null;

	/** Set the calendar `min` on the appointment date pickers to today (local). */
	private _refreshAppointmentDateMin(): void {
		const now = new Date();
		const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
		if (this._appointmentStartDatePicker) { this._appointmentStartDatePicker.min = todayIso; }
		if (this._appointmentEndDatePicker) { this._appointmentEndDatePicker.min = todayIso; }
	}

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

		// Populate provider options (mutate the array the custom dropdown reads).
		this._providerOptions.length = 0;
		for (const p of this.providers) {
			const value = (p as ProviderResult).id || (p as ProviderResult).fhirId || '';
			const prefix = (p as ProviderResult)['identification.prefix'] || '';
			const fn = (p as ProviderResult)['identification.firstName'] || (p as ProviderResult).firstName || '';
			const ln = (p as ProviderResult)['identification.lastName'] || (p as ProviderResult).lastName || '';
			const label = `${prefix} ${fn} ${ln}`.trim() || (p as ProviderResult).name || (p as ProviderResult).fullName || (p as ProviderResult).username || '';
			this._providerOptions.push({ value, label });
		}

		// Populate location options.
		this._locationOptions.length = 0;
		for (const l of this.locations) {
			this._locationOptions.push({ value: l.id, label: l.name });
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
			this._resetForm(this.patientOverlay);
			// Clear any inline validation errors left over from a previous attempt so
			// the form reopens clean — _resetForm only clears field VALUES, not the
			// red borders / ".ehr-field-error" messages, which otherwise persisted
			// across close/reopen (QA: reopened form showed all the prior errors).
			this._clearPatientFieldErrors();
			const errEl = this._patientFormElements.errorEl;
			if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
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
			this._refreshAppointmentDateMin();
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
			// Validates real calendar dates so impossible values (13/33/2000) leave
			// the hidden ISO field empty rather than forwarding a bad date.
			const usToIso = (us: string): string => usToIsoDate(us);
			// Native date picker overlays the calendar icon area (right 30 px) —
			// opacity:0 but fully clickable so a direct user click opens the native
			// calendar without needing showPicker() (which is unreliable in Electron).
			const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
			picker.type = 'date';
			picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
			visible.addEventListener('input', () => {
				// Auto-insert slashes and cap the year at 4 digits as the user types.
				const masked = maskUsDate(visible.value);
				if (masked !== visible.value) { visible.value = masked; }
				const iso = usToIso(visible.value);
				hidden.value = iso;
				const bad = !!visible.value && !iso;
				// Flag a typed-but-invalid date (e.g. 13/33/2000) so the form's save
				// handler can reject it — the hidden ISO is empty for these, which
				// otherwise reads as "no date" and lets the appointment save dateless.
				hidden.dataset.invalid = bad ? '1' : '';
				visible.style.borderColor = bad ? '#ef4444' : '';
				if (iso) { hidden.dispatchEvent(new Event('change', { bubbles: false })); }
			});
			picker.addEventListener('change', () => {
				visible.value = isoToUs(picker.value);
				hidden.value = picker.value;
				visible.dispatchEvent(new Event('input'));
				hidden.dispatchEvent(new Event('change', { bubbles: false }));
			});
			// Calendar icon — clickable so clicking the glyph itself opens the picker too
			const icon = DOM.append(wrap, DOM.$('span.codicon.codicon-calendar'));
			icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:13px;color:var(--vscode-descriptionForeground);cursor:pointer;line-height:1;';
			// Open the native calendar on any click in the icon column, not just on
			// the date input's tiny indicator glyph.
			enablePickerClick(picker, icon);
			return hidden;
		}

		// Time: use the custom HH:MM dropdown instead of <input type="time">. The
		// native time picker can't be reliably auto-closed in the Electron
		// workbench (blur() is a no-op there), so it stayed open after a selection
		// — the QA "time picker doesn't close" report. The custom dropdown commits
		// + closes deterministically when the minute is chosen.
		if (type === 'time') {
			const hidden = createTimeDropdown({
				parent: group,
				placeholder: 'Select time...',
				triggerStyle: EhrTitlebarControls._dropdownTriggerStyle,
			});
			hidden.name = name;
			return hidden;
		}

		const input = DOM.append(group, DOM.$(`input.ehr-form-input`)) as HTMLInputElement;
		input.type = type;
		input.name = name;
		if (type === 'tel') { input.placeholder = '(555) 123-4567'; }
		if (type === 'email') { input.placeholder = 'name@example.com'; }
		return input;
	}

	/** Shared trigger style so the custom dropdown matches `.ehr-form-input` exactly across themes. */
	private static readonly _dropdownTriggerStyle = 'width:100%;box-sizing:border-box;min-width:0;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;padding:7px 10px;font-family:inherit;cursor:pointer;';

	private _createSelectField(parent: HTMLElement, label: string, required: boolean, name: string, options: IDropdownOption[]): HTMLInputElement {
		const group = DOM.append(parent, DOM.$('.ehr-form-group'));
		const labelEl = DOM.append(group, DOM.$('label.ehr-form-label'));
		if (required) {
			const star = DOM.append(labelEl, DOM.$('span.ehr-required-star'));
			star.textContent = '*';
		}
		labelEl.append(` ${label}`);

		// Native <select> renders with OS chrome (an opaque box / accent border
		// that ignores the workbench theme), which in the light theme makes these
		// fields look "highlighted" compared to the text inputs. The shared themed
		// dropdown paints with `--vscode-*` variables so it matches the other
		// inputs on every theme.
		const defaultValue = options.length > 0 ? options[0].value : '';
		const select = createCustomDropdown({
			parent: group,
			options,
			initialValue: defaultValue,
			triggerStyle: EhrTitlebarControls._dropdownTriggerStyle,
		});
		select.name = name;
		// Remember the default so _resetForm can restore it (these fields have no
		// placeholder, so resetting to '' would blank a normally-preselected value).
		select.dataset.ehrDefault = defaultValue;
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

	/**
	 * Show an inline validation error beneath a Create-Patient field: tint the
	 * input border red and render a small message inside the field's
	 * `.ehr-form-group`. Custom-dropdown fields (e.g. Gender) have an inline-styled
	 * trigger rather than an `.ehr-form-input`, so only the message is shown for
	 * those (clearing their border later would otherwise drop the themed color).
	 */
	private _setFieldError(field: HTMLElement, message: string): void {
		const group = (field.closest('.ehr-form-group') as HTMLElement | null) ?? field.parentElement;
		if (!group) { return; }
		if (DOM.isHTMLInputElement(field) && field.classList.contains('ehr-form-input')) {
			field.style.borderColor = '#ef4444';
		}
		// eslint-disable-next-line no-restricted-syntax
		let err = group.querySelector(':scope > .ehr-field-error') as HTMLElement | null;
		if (!err) { err = DOM.append(group, DOM.$('.ehr-field-error')); }
		err.textContent = message;
		err.style.cssText = 'color:#f48771;font-size:11px;margin-top:4px;';
	}

	/** Clear all inline field errors and border highlights from the Create-Patient form. */
	private _clearPatientFieldErrors(): void {
		const overlay = this.patientOverlay;
		if (!overlay) { return; }
		// eslint-disable-next-line no-restricted-syntax
		overlay.querySelectorAll('.ehr-field-error').forEach(el => el.remove());
		// eslint-disable-next-line no-restricted-syntax
		overlay.querySelectorAll('input.ehr-form-input').forEach(el => { (el as HTMLElement).style.borderColor = ''; });
	}

	private readonly _patientFormElements: { inputs: HTMLInputElement[]; selects: HTMLInputElement[]; textareas: HTMLTextAreaElement[]; errorEl: HTMLElement | null } = { inputs: [], selects: [], textareas: [], errorEl: null };
	private readonly _appointmentFormElements: { inputs: HTMLInputElement[]; selects: HTMLInputElement[]; textareas: HTMLTextAreaElement[]; errorEl: HTMLElement | null } = { inputs: [], selects: [], textareas: [], errorEl: null };

	private _resetForm(form: HTMLElement): void {
		const elements = form === this.patientOverlay ? this._patientFormElements : this._appointmentFormElements;
		for (const el of elements.inputs) {
			if (el.type === 'checkbox') { el.checked = true; }
			else { el.value = ''; }
			// Date fields render as [visible-text, hidden, picker, icon] inside an
			// `.ehr-date-wrap`; only the hidden ISO input is tracked in `inputs`, so
			// clearing it alone leaves the visible MM/DD/YYYY text and the native
			// picker still showing the previous date. That stale display then reads
			// back as an empty start date on the next save ("Please enter a valid
			// Start Date (MM/DD/YYYY)."). Clear every input in the wrap so the field
			// is genuinely empty after a reset.
			const dateWrap = el.closest('.ehr-date-wrap');
			if (dateWrap) {
				// eslint-disable-next-line no-restricted-syntax
				dateWrap.querySelectorAll('input').forEach(inp => {
					inp.value = '';
					inp.dataset.invalid = '';
					inp.style.borderColor = '';
				});
			}
		}
		for (const el of elements.selects) {
			// Custom-dropdown inputs reset by writing their value (the overridden
			// value setter refreshes the visible trigger label). Restore the field's
			// recorded default option; dropdowns without one (provider/location)
			// fall back to '' which shows their placeholder.
			el.value = el.dataset.ehrDefault ?? '';
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
