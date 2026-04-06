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
	},
});
