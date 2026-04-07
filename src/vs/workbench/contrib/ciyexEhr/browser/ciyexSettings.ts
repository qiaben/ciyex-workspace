/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigExtensions, ConfigurationScope } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';

const configRegistry = Registry.as<IConfigurationRegistry>(ConfigExtensions.Configuration);

// ─── Server Connection Settings ──────────────────────────────────────

configRegistry.registerConfiguration({
	id: 'ciyex.server',
	order: 1,
	title: localize('ciyexServer', "Ciyex: Server"),
	properties: {
		'ciyex.server.apiUrl': {
			type: 'string',
			default: 'https://api-dev.ciyex.org',
			description: localize('ciyexApiUrl', "Ciyex API server URL. All EHR data is fetched from this endpoint."),
			scope: ConfigurationScope.APPLICATION,
			order: 1,
		},
		'ciyex.server.keycloakUrl': {
			type: 'string',
			default: 'https://dev.aran.me',
			description: localize('ciyexKeycloakUrl', "Keycloak authentication server URL for SSO login."),
			scope: ConfigurationScope.APPLICATION,
			order: 2,
		},
		'ciyex.server.keycloakRealm': {
			type: 'string',
			default: 'ciyex',
			description: localize('ciyexKeycloakRealm', "Keycloak realm name."),
			scope: ConfigurationScope.APPLICATION,
			order: 3,
		},
		'ciyex.server.keycloakClientId': {
			type: 'string',
			default: 'ciyex-app',
			description: localize('ciyexKeycloakClientId', "Keycloak OAuth2 client ID."),
			scope: ConfigurationScope.APPLICATION,
			order: 4,
		},
		'ciyex.server.environment': {
			type: 'string',
			enum: ['dev', 'staging', 'production'],
			default: 'dev',
			description: localize('ciyexEnvironment', "Deployment environment. Affects default server URLs and feature flags."),
			scope: ConfigurationScope.APPLICATION,
			order: 5,
		},
	},
});

// ─── Display Settings ────────────────────────────────────────────────

configRegistry.registerConfiguration({
	id: 'ciyex.display',
	order: 2,
	title: localize('ciyexDisplay', "Ciyex: Display"),
	properties: {
		'ciyex.display.fontSize': {
			type: 'string',
			enum: ['small', 'default', 'large', 'x-large'],
			enumDescriptions: [
				localize('fontSmall', "Small (87.5%)"),
				localize('fontDefault', "Default (100%)"),
				localize('fontLarge', "Large (112.5%)"),
				localize('fontXLarge', "Extra Large (125%)"),
			],
			default: 'default',
			description: localize('ciyexFontSize', "Font size scale for EHR content in webview panels."),
			scope: ConfigurationScope.WINDOW,
			order: 1,
		},
		'ciyex.display.compactMode': {
			type: 'boolean',
			default: false,
			description: localize('ciyexCompact', "Use compact row spacing in patient lists and tables."),
			scope: ConfigurationScope.WINDOW,
			order: 2,
		},
		'ciyex.display.showAvatars': {
			type: 'boolean',
			default: true,
			description: localize('ciyexAvatars', "Show colored avatar circles with initials in patient lists."),
			scope: ConfigurationScope.WINDOW,
			order: 3,
		},
	},
});

// ─── Calendar Settings ───────────────────────────────────────────────

configRegistry.registerConfiguration({
	id: 'ciyex.calendar',
	order: 3,
	title: localize('ciyexCalendar', "Ciyex: Calendar"),
	properties: {
		'ciyex.calendar.defaultView': {
			type: 'string',
			enum: ['day', 'week', 'month'],
			default: 'week',
			description: localize('ciyexCalView', "Default calendar view when opening the calendar."),
			scope: ConfigurationScope.WINDOW,
			order: 1,
		},
		'ciyex.calendar.startHour': {
			type: 'number',
			default: 8,
			minimum: 0,
			maximum: 23,
			description: localize('ciyexCalStart', "Calendar day start hour (0-23)."),
			scope: ConfigurationScope.WINDOW,
			order: 2,
		},
		'ciyex.calendar.endHour': {
			type: 'number',
			default: 18,
			minimum: 1,
			maximum: 24,
			description: localize('ciyexCalEnd', "Calendar day end hour (1-24)."),
			scope: ConfigurationScope.WINDOW,
			order: 3,
		},
		'ciyex.calendar.slotDuration': {
			type: 'number',
			enum: [10, 15, 20, 30, 60],
			default: 15,
			description: localize('ciyexCalSlot', "Appointment slot duration in minutes."),
			scope: ConfigurationScope.WINDOW,
			order: 4,
		},
		'ciyex.calendar.colorBy': {
			type: 'string',
			enum: ['visit-type', 'provider', 'location'],
			default: 'visit-type',
			description: localize('ciyexCalColor', "Color-code appointments by visit type, provider, or location."),
			scope: ConfigurationScope.WINDOW,
			order: 5,
		},
	},
});

// ─── Session Settings ────────────────────────────────────────────────

configRegistry.registerConfiguration({
	id: 'ciyex.session',
	order: 4,
	title: localize('ciyexSession', "Ciyex: Session"),
	properties: {
		'ciyex.session.idleTimeoutMinutes': {
			type: 'number',
			default: 30,
			minimum: 5,
			maximum: 480,
			description: localize('ciyexIdleTimeout', "Lock the workspace after this many minutes of inactivity."),
			scope: ConfigurationScope.WINDOW,
			order: 1,
		},
		'ciyex.session.warningMinutes': {
			type: 'number',
			default: 2,
			minimum: 1,
			maximum: 10,
			description: localize('ciyexWarning', "Show session expiry warning this many minutes before timeout."),
			scope: ConfigurationScope.WINDOW,
			order: 2,
		},
		'ciyex.session.autoRefreshToken': {
			type: 'boolean',
			default: true,
			description: localize('ciyexAutoRefresh', "Automatically refresh the authentication token before it expires."),
			scope: ConfigurationScope.WINDOW,
			order: 3,
		},
		'ciyex.session.loginRequired': {
			type: 'boolean',
			default: true,
			description: localize('ciyexLoginRequired', "Always require login when the workspace starts. When enabled (default), the login screen shows every time. When disabled, a valid cached token is reused and login is skipped. Users can still sign out manually via the status bar."),
			scope: ConfigurationScope.APPLICATION,
			order: 4,
		},
	},
});

// ─── EHR Features ────────────────────────────────────────────────────

configRegistry.registerConfiguration({
	id: 'ciyex.features',
	order: 5,
	title: localize('ciyexFeatures', "Ciyex: Features"),
	properties: {
		'ciyex.features.showDevMenus': {
			type: 'boolean',
			default: false,
			description: localize('ciyexDevMenus', "Show developer menus (Terminal, Run/Debug, Selection) in the menu bar."),
			scope: ConfigurationScope.WINDOW,
			order: 1,
		},
		'ciyex.features.cdsHooksEnabled': {
			type: 'boolean',
			default: true,
			description: localize('ciyexCdsHooks', "Enable CDS Hooks clinical decision support integration."),
			scope: ConfigurationScope.WINDOW,
			order: 2,
		},
		'ciyex.features.smartLaunchEnabled': {
			type: 'boolean',
			default: true,
			description: localize('ciyexSmartLaunch', "Enable SMART on FHIR app launching from the Hub."),
			scope: ConfigurationScope.WINDOW,
			order: 3,
		},
		'ciyex.features.patientPortalEnabled': {
			type: 'boolean',
			default: true,
			description: localize('ciyexPortal', "Enable patient portal integration."),
			scope: ConfigurationScope.WINDOW,
			order: 4,
		},
		'ciyex.features.telehealthEnabled': {
			type: 'boolean',
			default: false,
			description: localize('ciyexTelehealth', "Enable telehealth video visits."),
			scope: ConfigurationScope.WINDOW,
			order: 5,
		},
		'ciyex.features.kioskEnabled': {
			type: 'boolean',
			default: false,
			description: localize('ciyexKiosk', "Enable patient check-in kiosk mode."),
			scope: ConfigurationScope.WINDOW,
			order: 6,
		},
		'ciyex.features.inventoryEnabled': {
			type: 'boolean',
			default: false,
			description: localize('ciyexInventory', "Enable inventory management module."),
			scope: ConfigurationScope.WINDOW,
			order: 7,
		},
		'ciyex.features.faxEnabled': {
			type: 'boolean',
			default: false,
			description: localize('ciyexFax', "Enable fax sending and receiving."),
			scope: ConfigurationScope.WINDOW,
			order: 8,
		},
	},
});

configRegistry.registerConfiguration({
	id: 'ciyex.practice',
	order: 6,
	title: localize('ciyexPractice', "Ciyex: Practice"),
	properties: {
		'ciyex.practice.name': {
			type: 'string',
			default: '',
			description: localize('practiceName', "Practice name displayed throughout the application."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.practice.npi': {
			type: 'string',
			default: '',
			description: localize('practiceNpi', "Practice NPI (10-digit National Provider Identifier)."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.practice.timezone': {
			type: 'string',
			enum: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'],
			default: 'America/New_York',
			description: localize('practiceTz', "Practice timezone for scheduling and display."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.practice.sessionTimeoutMinutes': {
			type: 'number',
			default: 30,
			minimum: 5,
			maximum: 480,
			description: localize('practiceTimeout', "Practice-wide session timeout in minutes."),
			scope: ConfigurationScope.APPLICATION,
		},
	},
});

configRegistry.registerConfiguration({
	id: 'ciyex.ai',
	order: 7,
	title: localize('ciyexAi', "Ciyex: AI"),
	properties: {
		'ciyex.ai.enabled': {
			type: 'boolean',
			default: false,
			description: localize('aiEnabled', "Enable AI-powered features (clinical notes, coding suggestions, summaries)."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.ai.provider': {
			type: 'string',
			enum: ['openai', 'anthropic', 'azure-openai', 'local'],
			default: 'openai',
			description: localize('aiProvider', "AI service provider."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.ai.features.clinicalNotes': {
			type: 'boolean',
			default: false,
			description: localize('aiNotes', "AI-generated clinical note drafts from encounter data."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.ai.features.codingSuggestions': {
			type: 'boolean',
			default: false,
			description: localize('aiCoding', "AI-suggested ICD-10 and CPT codes from notes."),
			scope: ConfigurationScope.WINDOW,
		},
	},
});

configRegistry.registerConfiguration({
	id: 'ciyex.billing',
	order: 8,
	title: localize('ciyexBilling', "Ciyex: Billing"),
	properties: {
		'ciyex.billing.requireDiagnosis': {
			type: 'boolean',
			default: true,
			description: localize('billingDx', "Require at least one diagnosis code before closing an encounter."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.billing.autoPostCharges': {
			type: 'boolean',
			default: false,
			description: localize('billingAutoPost', "Auto-post charges when encounter is signed off."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.billing.defaultPlaceOfService': {
			type: 'string',
			default: '11',
			description: localize('billingPos', "Default Place of Service code (e.g., 11 = Office)."),
			scope: ConfigurationScope.WINDOW,
		},
	},
});

configRegistry.registerConfiguration({
	id: 'ciyex.prescriptions',
	order: 9,
	title: localize('ciyexRx', "Ciyex: Prescriptions"),
	properties: {
		'ciyex.prescriptions.eRxEnabled': {
			type: 'boolean',
			default: false,
			description: localize('rxErx', "Enable electronic prescribing (e-Rx)."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.prescriptions.controlledSubstanceCheck': {
			type: 'boolean',
			default: true,
			description: localize('rxControlled', "Check PDMP for controlled substance prescriptions."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.prescriptions.drugInteractionCheck': {
			type: 'boolean',
			default: true,
			description: localize('rxInteraction', "Check drug-drug interactions when prescribing."),
			scope: ConfigurationScope.WINDOW,
		},
	},
});

// Calendar Colors (simple settings here, advanced color editor via Cmd+Shift+P "Open Calendar Colors")
configRegistry.registerConfiguration({
	id: 'ciyex.calendarColors',
	order: 10,
	title: localize('ciyexCalColors', "Ciyex: Calendar Colors"),
	properties: {
		'ciyex.calendarColors.colorBy': {
			type: 'string',
			enum: ['visit-type', 'provider', 'location'],
			default: 'visit-type',
			description: localize('calColorBy', "Color-code calendar appointments by this category."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.calendarColors.workingHoursBg': {
			type: 'string',
			default: '#ffffff',
			description: localize('calWorkingBg', "Background color for working hours on calendar."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.calendarColors.nonWorkingHoursBg': {
			type: 'string',
			default: '#f1f5f9',
			description: localize('calNonWorkingBg', "Background color for non-working hours on calendar."),
			scope: ConfigurationScope.WINDOW,
		},
	},
});

// Patient Portal (simple settings here, advanced form/nav editor via Cmd+Shift+P "Open Patient Portal")
configRegistry.registerConfiguration({
	id: 'ciyex.portal',
	order: 11,
	title: localize('ciyexPortalSettings', "Ciyex: Patient Portal"),
	properties: {
		'ciyex.portal.name': {
			type: 'string',
			default: 'Patient Portal',
			description: localize('portalName', "Portal display name shown to patients."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.portal.url': {
			type: 'string',
			default: '',
			description: localize('portalUrl', "Portal URL (e.g., https://portal.example.com)."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.portal.language': {
			type: 'string',
			enum: ['en', 'es', 'fr'],
			default: 'en',
			description: localize('portalLang', "Portal default language."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.portal.onlineBooking': {
			type: 'boolean',
			default: true,
			description: localize('portalBooking', "Allow patients to book appointments online."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.portal.messaging': {
			type: 'boolean',
			default: true,
			description: localize('portalMsg', "Allow patient-provider messaging."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.portal.labResults': {
			type: 'boolean',
			default: true,
			description: localize('portalLabs', "Allow patients to view lab results."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.portal.prescriptionRefills': {
			type: 'boolean',
			default: true,
			description: localize('portalRx', "Allow patients to request prescription refills."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.portal.billPay': {
			type: 'boolean',
			default: false,
			description: localize('portalBill', "Allow patients to pay bills online."),
			scope: ConfigurationScope.WINDOW,
		},
		'ciyex.portal.telehealth': {
			type: 'boolean',
			default: false,
			description: localize('portalTele', "Allow patients to join telehealth visits."),
			scope: ConfigurationScope.WINDOW,
		},
	},
});

// Roles & Permissions (role list shown here, detailed scope/permission matrix via Cmd+Shift+P "Open Roles & Permissions")
configRegistry.registerConfiguration({
	id: 'ciyex.roles',
	order: 12,
	title: localize('ciyexRolesSettings', "Ciyex: Roles & Permissions"),
	properties: {
		'ciyex.roles.defaultRole': {
			type: 'string',
			enum: ['admin', 'physician', 'nurse', 'receptionist', 'billing', 'patient'],
			default: 'receptionist',
			description: localize('defaultRole', "Default role assigned to new staff users."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.roles.patientRole': {
			type: 'string',
			default: 'patient',
			description: localize('patientRole', "Role assigned to patient portal users."),
			scope: ConfigurationScope.APPLICATION,
		},
		'ciyex.roles.requireMfa': {
			type: 'boolean',
			default: false,
			description: localize('rolesMfa', "Require multi-factor authentication for admin roles."),
			scope: ConfigurationScope.APPLICATION,
		},
	},
});
