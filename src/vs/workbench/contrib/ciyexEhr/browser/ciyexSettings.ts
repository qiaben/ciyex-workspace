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

// --- Layout Configuration (links to visual editors) ------------------

configRegistry.registerConfiguration({
	id: 'ciyex.layoutConfig',
	order: 27,
	title: localize('ciyexLayoutConfig', "Ciyex: Layout Configuration"),
	properties: {
		'ciyex.layout.chartLayout': { type: 'null', markdownDescription: localize('cfgChartLayout', "Configure patient chart tabs and categories.\n\n[Open Chart Layout Editor](command:ciyex.openChartLayout)"), scope: ConfigurationScope.WINDOW },
		'ciyex.layout.encounterForm': { type: 'null', markdownDescription: localize('cfgEncounter', "Configure encounter form sections (CC, HPI, ROS, PE, Assessment, Plan, etc.).\n\n[Open Encounter Form Editor](command:ciyex.openEncounterConfig)"), scope: ConfigurationScope.WINDOW },
		'ciyex.layout.menuConfig': { type: 'null', markdownDescription: localize('cfgMenu', "Configure sidebar and menu bar navigation items.\n\n[Open Menu Configuration Editor](command:ciyex.openMenuConfig)"), scope: ConfigurationScope.WINDOW },
	},
});

configRegistry.registerConfiguration({
	id: 'ciyex.fieldConfig',
	order: 28,
	title: localize('ciyexFieldConfig', "Ciyex: Field Configuration"),
	properties: {
		'ciyex.fields.demographics': { type: 'null', markdownDescription: localize('cfgDemo', "Configure patient demographics form fields and FHIR mappings.\n\n[Open Demographics Editor](command:ciyex.openFieldConfig 'demographics')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.vitals': { type: 'null', markdownDescription: localize('cfgVitals', "Configure vital signs form with dual unit system.\n\n[Open Vitals Editor](command:ciyex.openFieldConfig 'vitals')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.problems': { type: 'null', markdownDescription: localize('cfgProblems', "Configure problems/conditions form with ICD-10 lookup.\n\n[Open Problems Editor](command:ciyex.openFieldConfig 'problems')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.allergies': { type: 'null', markdownDescription: localize('cfgAllergies', "Configure allergy intolerance form fields.\n\n[Open Allergies Editor](command:ciyex.openFieldConfig 'allergies')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.medications': { type: 'null', markdownDescription: localize('cfgMeds', "Configure medication/prescription form with NDC lookup.\n\n[Open Medications Editor](command:ciyex.openFieldConfig 'medications')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.immunizations': { type: 'null', markdownDescription: localize('cfgImm', "Configure immunization form with CVX codes.\n\n[Open Immunizations Editor](command:ciyex.openFieldConfig 'immunizations')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.labs': { type: 'null', markdownDescription: localize('cfgLabs', "Configure lab results form with LOINC codes.\n\n[Open Lab Results Editor](command:ciyex.openFieldConfig 'labs')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.appointments': { type: 'null', markdownDescription: localize('cfgAppt', "Configure appointment form with visit types.\n\n[Open Appointments Editor](command:ciyex.openFieldConfig 'appointments')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.insurance': { type: 'null', markdownDescription: localize('cfgInsFields', "Configure insurance/coverage form fields.\n\n[Open Insurance Editor](command:ciyex.openFieldConfig 'insurance')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.providers': { type: 'null', markdownDescription: localize('cfgProv', "Configure provider registration form.\n\n[Open Providers Editor](command:ciyex.openFieldConfig 'providers')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.facilities': { type: 'null', markdownDescription: localize('cfgFac', "Configure facility/location form.\n\n[Open Facilities Editor](command:ciyex.openFieldConfig 'facilities')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.documents': { type: 'null', markdownDescription: localize('cfgDocs', "Configure document upload form.\n\n[Open Documents Editor](command:ciyex.openFieldConfig 'documents')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.referrals': { type: 'null', markdownDescription: localize('cfgRef', "Configure referral/service request form.\n\n[Open Referrals Editor](command:ciyex.openFieldConfig 'referrals')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.history': { type: 'null', markdownDescription: localize('cfgHist', "Configure family, social, and surgical history form.\n\n[Open History Editor](command:ciyex.openFieldConfig 'history')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.visitNotes': { type: 'null', markdownDescription: localize('cfgNotes', "Configure clinical visit notes form.\n\n[Open Visit Notes Editor](command:ciyex.openFieldConfig 'visit-notes')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.practice': { type: 'null', markdownDescription: localize('cfgPractice', "Configure practice info form.\n\n[Open Practice Editor](command:ciyex.openFieldConfig 'practice')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.referralProviders': { type: 'null', markdownDescription: localize('cfgRefProv', "Configure referral provider form.\n\n[Open Referral Providers Editor](command:ciyex.openFieldConfig 'referral-providers')"), scope: ConfigurationScope.WINDOW },
		'ciyex.fields.referralPractices': { type: 'null', markdownDescription: localize('cfgRefPrac', "Configure referral practice form.\n\n[Open Referral Practices Editor](command:ciyex.openFieldConfig 'referral-practices')"), scope: ConfigurationScope.WINDOW },
	},
});

// --- Clinical Workflow -----------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.clinical',
	order: 13,
	title: localize('ciyexClinical', "Ciyex: Clinical Workflow"),
	properties: {
		'ciyex.clinical.defaultEncounterForm': { type: 'string', default: 'standard', description: localize('clinDefaultForm', "Default encounter form template."), scope: ConfigurationScope.WINDOW },
		'ciyex.clinical.soapAutoSaveMinutes': { type: 'number', default: 2, minimum: 1, maximum: 30, description: localize('clinAutoSave', "Auto-save interval for SOAP notes (minutes)."), scope: ConfigurationScope.WINDOW },
		'ciyex.clinical.unitsOfMeasurement': { type: 'string', enum: ['imperial', 'metric'], default: 'imperial', description: localize('clinUnits', "Units of measurement for vitals and measurements."), scope: ConfigurationScope.WINDOW },
		'ciyex.clinical.advanceDirectivesWarning': { type: 'boolean', default: true, description: localize('clinAdvDir', "Alert when patient has advance directives on file."), scope: ConfigurationScope.WINDOW },
		'ciyex.clinical.enableAmendments': { type: 'boolean', default: true, description: localize('clinAmend', "Allow amendments to signed clinical records."), scope: ConfigurationScope.WINDOW },
		'ciyex.clinical.enableTextTemplates': { type: 'boolean', default: true, description: localize('clinTemplates', "Enable text templates/macros in encounter forms."), scope: ConfigurationScope.WINDOW },
		'ciyex.clinical.ageDisplayFormat': { type: 'string', enum: ['years', 'years-months', 'auto'], default: 'auto', description: localize('clinAge', "How to display patient age (auto switches to months for infants)."), scope: ConfigurationScope.WINDOW },
		'ciyex.clinical.defaultVisitCategory': { type: 'string', default: 'Office Visit', description: localize('clinVisitCat', "Default category for new visits."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Notifications / Email / SMS -------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.notifications',
	order: 14,
	title: localize('ciyexNotifications', "Ciyex: Notifications"),
	properties: {
		'ciyex.notifications.senderName': { type: 'string', default: '', description: localize('notifSender', "Sender name for patient reminders and emails."), scope: ConfigurationScope.APPLICATION },
		'ciyex.notifications.senderEmail': { type: 'string', default: '', description: localize('notifEmail', "Sender email address for notifications."), scope: ConfigurationScope.APPLICATION },
		'ciyex.notifications.adminEmail': { type: 'string', default: '', description: localize('notifAdmin', "Admin notification email address."), scope: ConfigurationScope.APPLICATION },
		'ciyex.notifications.smtpHost': { type: 'string', default: '', description: localize('notifSmtp', "SMTP server hostname for sending email."), scope: ConfigurationScope.APPLICATION },
		'ciyex.notifications.smtpPort': { type: 'number', default: 587, description: localize('notifPort', "SMTP server port."), scope: ConfigurationScope.APPLICATION },
		'ciyex.notifications.smtpSecurity': { type: 'string', enum: ['none', 'tls', 'ssl'], default: 'tls', description: localize('notifSec', "SMTP security protocol."), scope: ConfigurationScope.APPLICATION },
		'ciyex.notifications.emailReminderHours': { type: 'number', default: 48, description: localize('notifEmailHrs', "Hours before appointment to send email reminder."), scope: ConfigurationScope.WINDOW },
		'ciyex.notifications.smsReminderHours': { type: 'number', default: 24, description: localize('notifSmsHrs', "Hours before appointment to send SMS reminder."), scope: ConfigurationScope.WINDOW },
		'ciyex.notifications.smsGatewayApiKey': { type: 'string', default: '', description: localize('notifSmsKey', "SMS gateway API key (Twilio, etc.)."), scope: ConfigurationScope.APPLICATION },
		'ciyex.notifications.appointmentReminderChannels': { type: 'string', enum: ['email', 'sms', 'both', 'none'], default: 'both', description: localize('notifChannels', "Default reminder channels for appointments."), scope: ConfigurationScope.WINDOW },
		'ciyex.notifications.dailyAgendaEmail': { type: 'boolean', default: false, description: localize('notifAgenda', "Send daily schedule email to providers."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Audit / Compliance ----------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.audit',
	order: 15,
	title: localize('ciyexAudit', "Ciyex: Audit & Compliance"),
	properties: {
		'ciyex.audit.enabled': { type: 'boolean', default: true, description: localize('auditEnabled', "Enable audit logging for HIPAA compliance."), scope: ConfigurationScope.APPLICATION },
		'ciyex.audit.patientRecordAccess': { type: 'boolean', default: true, description: localize('auditPatient', "Log all patient record access events."), scope: ConfigurationScope.APPLICATION },
		'ciyex.audit.schedulingChanges': { type: 'boolean', default: true, description: localize('auditSched', "Log scheduling create/modify/delete events."), scope: ConfigurationScope.APPLICATION },
		'ciyex.audit.orderActivity': { type: 'boolean', default: true, description: localize('auditOrders', "Log all order activity (labs, prescriptions, referrals)."), scope: ConfigurationScope.APPLICATION },
		'ciyex.audit.securityAdmin': { type: 'boolean', default: true, description: localize('auditSecurity', "Log security and administration changes."), scope: ConfigurationScope.APPLICATION },
		'ciyex.audit.logEncryption': { type: 'boolean', default: false, description: localize('auditEncrypt', "Encrypt audit log entries."), scope: ConfigurationScope.APPLICATION },
		'ciyex.compliance.mipsEnabled': { type: 'boolean', default: false, description: localize('compMips', "Enable MIPS quality reporting."), scope: ConfigurationScope.APPLICATION },
		'ciyex.compliance.mipsReportingYear': { type: 'number', default: 2026, description: localize('compMipsYear', "MIPS performance period year."), scope: ConfigurationScope.APPLICATION },
		'ciyex.compliance.cqmEnabled': { type: 'boolean', default: false, description: localize('compCqm', "Enable Clinical Quality Measures reporting."), scope: ConfigurationScope.APPLICATION },
	},
});

// --- Security / Password Policy --------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.security',
	order: 16,
	title: localize('ciyexSecurity', "Ciyex: Security"),
	properties: {
		'ciyex.security.passwordMinLength': { type: 'number', default: 8, minimum: 6, maximum: 128, description: localize('secPwdMin', "Minimum password length."), scope: ConfigurationScope.APPLICATION },
		'ciyex.security.passwordRequireStrong': { type: 'boolean', default: true, description: localize('secPwdStrong', "Require strong passwords (uppercase, lowercase, number, special char)."), scope: ConfigurationScope.APPLICATION },
		'ciyex.security.passwordExpirationDays': { type: 'number', default: 90, minimum: 0, maximum: 365, description: localize('secPwdExpire', "Days until password expires (0 = never)."), scope: ConfigurationScope.APPLICATION },
		'ciyex.security.maxFailedLoginAttempts': { type: 'number', default: 5, minimum: 3, maximum: 20, description: localize('secMaxFailed', "Account lockout after N failed login attempts."), scope: ConfigurationScope.APPLICATION },
		'ciyex.security.twoFactorAuth': { type: 'string', enum: ['disabled', 'optional', 'required-admin', 'required-all'], default: 'optional', description: localize('sec2fa', "Two-factor authentication requirement."), scope: ConfigurationScope.APPLICATION },
		'ciyex.security.ssoEnabled': { type: 'boolean', default: true, description: localize('secSso', "Enable Single Sign-On via Keycloak/SAML."), scope: ConfigurationScope.APPLICATION },
	},
});

// --- E-Sign / Consent ------------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.esign',
	order: 17,
	title: localize('ciyexEsign', "Ciyex: E-Sign & Consent"),
	properties: {
		'ciyex.esign.encounterSigningEnabled': { type: 'boolean', default: true, description: localize('esignEnc', "Enable electronic signing of encounters."), scope: ConfigurationScope.WINDOW },
		'ciyex.esign.lockOnSign': { type: 'boolean', default: true, description: localize('esignLock', "Lock encounter after signing (prevent further edits)."), scope: ConfigurationScope.WINDOW },
		'ciyex.esign.formSigningEnabled': { type: 'boolean', default: true, description: localize('esignForm', "Enable electronic signing of individual forms."), scope: ConfigurationScope.WINDOW },
		'ciyex.esign.cosignRequired': { type: 'boolean', default: false, description: localize('esignCosign', "Require co-signature for mid-level providers."), scope: ConfigurationScope.WINDOW },
		'ciyex.consent.telehealthRequired': { type: 'boolean', default: true, description: localize('consentTele', "Require telehealth consent before video visit."), scope: ConfigurationScope.WINDOW },
		'ciyex.consent.immunizationReporting': { type: 'boolean', default: true, description: localize('consentImm', "Default consent for immunization registry reporting."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Telehealth (expanded) -------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.telehealth',
	order: 18,
	title: localize('ciyexTelehealth', "Ciyex: Telehealth"),
	properties: {
		'ciyex.telehealth.provider': { type: 'string', enum: ['built-in', 'zoom', 'doxy', 'custom'], default: 'built-in', description: localize('teleProvider', "Video visit platform provider."), scope: ConfigurationScope.APPLICATION },
		'ciyex.telehealth.waitingRoomEnabled': { type: 'boolean', default: true, description: localize('teleWaiting', "Enable virtual waiting room for patients."), scope: ConfigurationScope.WINDOW },
		'ciyex.telehealth.recordingEnabled': { type: 'boolean', default: false, description: localize('teleRecord', "Allow visit recording (requires patient consent)."), scope: ConfigurationScope.WINDOW },
		'ciyex.telehealth.maxDurationMinutes': { type: 'number', default: 60, minimum: 10, maximum: 240, description: localize('teleDuration', "Maximum telehealth visit duration (minutes)."), scope: ConfigurationScope.WINDOW },
		'ciyex.telehealth.screenShareEnabled': { type: 'boolean', default: true, description: localize('teleScreen', "Allow screen sharing during visits."), scope: ConfigurationScope.WINDOW },
		'ciyex.telehealth.multiPartyEnabled': { type: 'boolean', default: true, description: localize('teleMulti', "Allow multi-party visits (family, interpreter)."), scope: ConfigurationScope.WINDOW },
		'ciyex.telehealth.autoSendLink': { type: 'boolean', default: true, description: localize('teleAutoLink', "Auto-send video link to patient before visit."), scope: ConfigurationScope.WINDOW },
		'ciyex.telehealth.reminderMinutes': { type: 'number', default: 15, description: localize('teleReminder', "Minutes before visit to send reminder."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Documents -------------------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.documents',
	order: 19,
	title: localize('ciyexDocuments', "Ciyex: Documents"),
	properties: {
		'ciyex.documents.storageMethod': { type: 'string', enum: ['s3', 'local'], default: 's3', description: localize('docStorage', "Document storage method."), scope: ConfigurationScope.APPLICATION },
		'ciyex.documents.maxFileSizeMB': { type: 'number', default: 10, minimum: 1, maximum: 100, description: localize('docMaxSize', "Maximum file upload size (MB)."), scope: ConfigurationScope.WINDOW },
		'ciyex.documents.thumbnailEnabled': { type: 'boolean', default: true, description: localize('docThumb', "Generate document thumbnails."), scope: ConfigurationScope.WINDOW },
		'ciyex.documents.encryptOnDisk': { type: 'boolean', default: false, description: localize('docEncrypt', "Encrypt documents at rest."), scope: ConfigurationScope.APPLICATION },
		'ciyex.documents.scannerEnabled': { type: 'boolean', default: false, description: localize('docScanner', "Enable scanner/TWAIN support."), scope: ConfigurationScope.WINDOW },
		'ciyex.documents.faxProvider': { type: 'string', enum: ['none', 'sfax', 'hylafax', 'srfax'], default: 'none', description: localize('docFax', "Fax service provider."), scope: ConfigurationScope.APPLICATION },
	},
});

// --- Insurance / Eligibility -----------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.insurance',
	order: 20,
	title: localize('ciyexInsurance', "Ciyex: Insurance"),
	properties: {
		'ciyex.insurance.eligibilityVerification': { type: 'boolean', default: true, description: localize('insElig', "Enable real-time insurance eligibility verification."), scope: ConfigurationScope.WINDOW },
		'ciyex.insurance.eligibilityProvider': { type: 'string', default: '', description: localize('insEligProvider', "Eligibility verification service (e.g., Office Ally, Availity)."), scope: ConfigurationScope.APPLICATION },
		'ciyex.insurance.allowMultipleInsurance': { type: 'boolean', default: true, description: localize('insMultiple', "Allow primary, secondary, and tertiary insurance."), scope: ConfigurationScope.WINDOW },
		'ciyex.insurance.autoVerifyOnCheckIn': { type: 'boolean', default: false, description: localize('insAutoVerify', "Auto-verify eligibility on patient check-in."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Reporting / Analytics -------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.reporting',
	order: 21,
	title: localize('ciyexReporting', "Ciyex: Reporting"),
	properties: {
		'ciyex.reporting.endOfDayReport': { type: 'boolean', default: true, description: localize('repEod', "Enable end-of-day report generation."), scope: ConfigurationScope.WINDOW },
		'ciyex.reporting.endOfDayByProvider': { type: 'boolean', default: true, description: localize('repEodProv', "Generate end-of-day reports per provider."), scope: ConfigurationScope.WINDOW },
		'ciyex.reporting.dashboardEnabled': { type: 'boolean', default: true, description: localize('repDash', "Enable real-time reporting dashboard."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Patient Flow Board ----------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.flowBoard',
	order: 22,
	title: localize('ciyexFlowBoard', "Ciyex: Patient Flow Board"),
	properties: {
		'ciyex.flowBoard.enabled': { type: 'boolean', default: true, description: localize('fbEnabled', "Enable patient flow board / waiting room display."), scope: ConfigurationScope.WINDOW },
		'ciyex.flowBoard.refreshIntervalSeconds': { type: 'number', default: 30, minimum: 10, maximum: 300, description: localize('fbRefresh', "Auto-refresh interval (seconds)."), scope: ConfigurationScope.WINDOW },
		'ciyex.flowBoard.showVisitReason': { type: 'boolean', default: true, description: localize('fbReason', "Show reason for visit on flow board."), scope: ConfigurationScope.WINDOW },
		'ciyex.flowBoard.showWaitTime': { type: 'boolean', default: true, description: localize('fbWait', "Show wait time on flow board."), scope: ConfigurationScope.WINDOW },
	},
});

// --- PDF / Print -----------------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.print',
	order: 23,
	title: localize('ciyexPrint', "Ciyex: Print & PDF"),
	properties: {
		'ciyex.print.paperSize': { type: 'string', enum: ['letter', 'a4', 'legal'], default: 'letter', description: localize('printPaper', "Default paper size for printing and PDF export."), scope: ConfigurationScope.WINDOW },
		'ciyex.print.orientation': { type: 'string', enum: ['portrait', 'landscape'], default: 'portrait', description: localize('printOrient', "Default print orientation."), scope: ConfigurationScope.WINDOW },
		'ciyex.print.fontSize': { type: 'number', default: 10, minimum: 8, maximum: 14, description: localize('printFont', "Default font size for printed documents (pt)."), scope: ConfigurationScope.WINDOW },
		'ciyex.print.showPracticeLogo': { type: 'boolean', default: true, description: localize('printLogo', "Include practice logo on printed documents."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Kiosk (expanded) ------------------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.kiosk',
	order: 24,
	title: localize('ciyexKiosk', "Ciyex: Patient Kiosk"),
	properties: {
		'ciyex.kiosk.demographicsVerification': { type: 'boolean', default: true, description: localize('kioskDemo', "Require demographics verification at check-in."), scope: ConfigurationScope.WINDOW },
		'ciyex.kiosk.insuranceCapture': { type: 'boolean', default: true, description: localize('kioskIns', "Allow insurance card photo capture at kiosk."), scope: ConfigurationScope.WINDOW },
		'ciyex.kiosk.copayCollection': { type: 'boolean', default: false, description: localize('kioskCopay', "Collect copay at kiosk check-in."), scope: ConfigurationScope.WINDOW },
		'ciyex.kiosk.consentForms': { type: 'boolean', default: true, description: localize('kioskConsent', "Display consent forms at kiosk."), scope: ConfigurationScope.WINDOW },
		'ciyex.kiosk.idleTimeoutSeconds': { type: 'number', default: 120, minimum: 30, maximum: 600, description: localize('kioskTimeout', "Kiosk session timeout (seconds)."), scope: ConfigurationScope.WINDOW },
	},
});

// --- Lab / Imaging (expanded) ----------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.labExpanded',
	order: 25,
	title: localize('ciyexLabExp', "Ciyex: Lab & Imaging"),
	properties: {
		'ciyex.lab.hl7Enabled': { type: 'boolean', default: false, description: localize('labHl7', "Enable HL7 message processing for lab interfaces."), scope: ConfigurationScope.APPLICATION },
		'ciyex.lab.abnormalResultAlerts': { type: 'boolean', default: true, description: localize('labAbnormal', "Alert providers on abnormal lab results."), scope: ConfigurationScope.WINDOW },
		'ciyex.lab.criticalValueAlerts': { type: 'boolean', default: true, description: localize('labCritical', "Urgent notification for critical lab values."), scope: ConfigurationScope.WINDOW },
		'ciyex.lab.immunizationRegistryEnabled': { type: 'boolean', default: false, description: localize('labIis', "Enable immunization registry (IIS) reporting."), scope: ConfigurationScope.APPLICATION },
	},
});

// --- Prescription (expanded) -----------------------------------------

configRegistry.registerConfiguration({
	id: 'ciyex.rxExpanded',
	order: 26,
	title: localize('ciyexRxExp', "Ciyex: Prescriptions (Advanced)"),
	properties: {
		'ciyex.prescriptions.eRxProvider': { type: 'string', enum: ['none', 'surescripts', 'newcrop', 'weno'], default: 'none', description: localize('rxProvider', "Electronic prescribing service provider."), scope: ConfigurationScope.APPLICATION },
		'ciyex.prescriptions.epcsEnabled': { type: 'boolean', default: false, description: localize('rxEpcs', "Enable electronic prescribing of controlled substances (EPCS)."), scope: ConfigurationScope.APPLICATION },
		'ciyex.prescriptions.showDeaNumber': { type: 'boolean', default: true, description: localize('rxDea', "Show DEA number on prescriptions."), scope: ConfigurationScope.WINDOW },
		'ciyex.prescriptions.showNpi': { type: 'boolean', default: true, description: localize('rxNpi', "Show NPI on prescriptions."), scope: ConfigurationScope.WINDOW },
		'ciyex.prescriptions.tallManNames': { type: 'boolean', default: true, description: localize('rxTallMan', "Display Tall Man medication names for safety."), scope: ConfigurationScope.WINDOW },
		'ciyex.prescriptions.formularySearch': { type: 'boolean', default: false, description: localize('rxFormulary', "Default to formulary search when prescribing."), scope: ConfigurationScope.WINDOW },
	},
});
