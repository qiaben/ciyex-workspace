/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// import { isWeb, isWindows } from '../../../../base/common/platform.js'; // unused after removing dev sections
import { localize } from '../../../../nls.js';
import { ISetting, ISettingsGroup } from '../../../services/preferences/common/preferences.js';

export interface ITOCFilter {
	include?: {
		keyPatterns?: string[];
		tags?: string[];
	};
	exclude?: {
		keyPatterns?: string[];
		tags?: string[];
	};
}

export interface ITOCEntry<T> {
	id: string;
	label: string;
	order?: number;
	children?: ITOCEntry<T>[];
	settings?: Array<T>;
	hide?: boolean;
}

// Commonly Used settings hidden for EHR app
/* eslint-disable */
// COMMONLY_USED_SETTINGS removed for EHR app

export function getCommonlyUsedData(settingGroups: ISettingsGroup[]): ITOCEntry<ISetting> {
	const allSettings = new Map<string, ISetting>();
	for (const group of settingGroups) {
		for (const section of group.sections) {
			for (const s of section.settings) {
				allSettings.set(s.key, s);
			}
		}
	}
	// "Commonly Used" section hidden for EHR app — only Ciyex settings shown
	return {
		id: 'commonlyUsed',
		label: localize('commonlyUsed', "Commonly Used"),
		settings: []
	};
}

export const tocData: ITOCEntry<string> = {
	id: 'root',
	label: 'root',
	children: [
		{ id: 'ciyex/practice', label: localize('ciyexPracticeToc', "Practice"), settings: ['ciyex.practice.*'] },
		{ id: 'ciyex/clinical', label: localize('ciyexClinicalToc', "Clinical Workflow"), settings: ['ciyex.clinical.*'] },
		{ id: 'ciyex/calendar', label: localize('ciyexCalendarToc', "Calendar"), settings: ['ciyex.calendar.*', 'ciyex.calendarColors.*'] },
		{ id: 'ciyex/billing', label: localize('ciyexBillingToc', "Billing"), settings: ['ciyex.billing.*'] },
		{ id: 'ciyex/prescriptions', label: localize('ciyexRxToc', "Prescriptions"), settings: ['ciyex.prescriptions.*'] },
		{ id: 'ciyex/lab', label: localize('ciyexLabToc', "Lab & Imaging"), settings: ['ciyex.lab.*'] },
		{ id: 'ciyex/telehealth', label: localize('ciyexTeleToc', "Telehealth"), settings: ['ciyex.telehealth.*'] },
		{ id: 'ciyex/portal', label: localize('ciyexPortalToc', "Patient Portal"), settings: ['ciyex.portal.*'] },
		{ id: 'ciyex/notifications', label: localize('ciyexNotifToc', "Notifications"), settings: ['ciyex.notifications.*'] },
		{ id: 'ciyex/security', label: localize('ciyexSecToc', "Security"), settings: ['ciyex.security.*', 'ciyex.session.*'] },
		{ id: 'ciyex/audit', label: localize('ciyexAuditToc', "Audit & Compliance"), settings: ['ciyex.audit.*', 'ciyex.compliance.*'] },
		{ id: 'ciyex/esign', label: localize('ciyexEsignToc', "E-Sign & Consent"), settings: ['ciyex.esign.*', 'ciyex.consent.*'] },
		{ id: 'ciyex/documents', label: localize('ciyexDocsToc', "Documents"), settings: ['ciyex.documents.*'] },
		{ id: 'ciyex/insurance', label: localize('ciyexInsToc', "Insurance"), settings: ['ciyex.insurance.*'] },
		{ id: 'ciyex/roles', label: localize('ciyexRolesToc', "Roles & Permissions"), settings: ['ciyex.roles.*'] },
		{ id: 'ciyex/features', label: localize('ciyexFeaturesToc', "Features"), settings: ['ciyex.features.*'] },
		{ id: 'ciyex/ai', label: localize('ciyexAiToc', "AI"), settings: ['ciyex.ai.*'] },
		{ id: 'ciyex/display', label: localize('ciyexDisplayToc', "Display"), settings: ['ciyex.display.*'] },
		{ id: 'ciyex/flowBoard', label: localize('ciyexFlowToc', "Patient Flow Board"), settings: ['ciyex.flowBoard.*'] },
		{ id: 'ciyex/kiosk', label: localize('ciyexKioskToc', "Kiosk"), settings: ['ciyex.kiosk.*'] },
		{ id: 'ciyex/print', label: localize('ciyexPrintToc', "Print & PDF"), settings: ['ciyex.print.*'] },
		{ id: 'ciyex/reporting', label: localize('ciyexReportToc', "Reporting"), settings: ['ciyex.reporting.*'] },
		{ id: 'ciyex/server', label: localize('ciyexServerToc', "Server"), settings: ['ciyex.server.*'] },
		{
			id: 'ciyex/layoutConfig',
			label: localize('ciyexLayoutToc', "Layout Configuration"),
			settings: ['ciyex.layout.*'],
			children: [
				{ id: 'ciyex/layoutConfig/chartLayout', label: localize('ciyexChartToc', "Chart Layout"), settings: ['ciyex.layout.chartLayout'] },
				{ id: 'ciyex/layoutConfig/encounter', label: localize('ciyexEncToc', "Encounter Form"), settings: ['ciyex.layout.encounterForm'] },
				{ id: 'ciyex/layoutConfig/menu', label: localize('ciyexMenuToc', "Menu Config"), settings: ['ciyex.layout.menuConfig'] },
			]
		},
		{
			id: 'ciyex/fieldConfig',
			label: localize('ciyexFieldsToc', "Field Configuration"),
			settings: ['ciyex.fields.*'],
			children: [
				{ id: 'ciyex/fieldConfig/demographics', label: localize('ciyexFDemoToc', "Demographics"), settings: ['ciyex.fields.demographics'] },
				{ id: 'ciyex/fieldConfig/vitals', label: localize('ciyexFVitalsToc', "Vitals"), settings: ['ciyex.fields.vitals'] },
				{ id: 'ciyex/fieldConfig/problems', label: localize('ciyexFProbToc', "Problems"), settings: ['ciyex.fields.problems'] },
				{ id: 'ciyex/fieldConfig/allergies', label: localize('ciyexFAllergyToc', "Allergies"), settings: ['ciyex.fields.allergies'] },
				{ id: 'ciyex/fieldConfig/medications', label: localize('ciyexFMedsToc', "Medications"), settings: ['ciyex.fields.medications'] },
				{ id: 'ciyex/fieldConfig/immunizations', label: localize('ciyexFImmToc', "Immunizations"), settings: ['ciyex.fields.immunizations'] },
				{ id: 'ciyex/fieldConfig/labs', label: localize('ciyexFLabsToc', "Lab Results"), settings: ['ciyex.fields.labs'] },
				{ id: 'ciyex/fieldConfig/appointments', label: localize('ciyexFApptToc', "Appointments"), settings: ['ciyex.fields.appointments'] },
				{ id: 'ciyex/fieldConfig/insurance', label: localize('ciyexFInsToc', "Insurance"), settings: ['ciyex.fields.insurance'] },
				{ id: 'ciyex/fieldConfig/providers', label: localize('ciyexFProvToc', "Providers"), settings: ['ciyex.fields.providers'] },
				{ id: 'ciyex/fieldConfig/facilities', label: localize('ciyexFFacToc', "Facilities"), settings: ['ciyex.fields.facilities'] },
				{ id: 'ciyex/fieldConfig/documents', label: localize('ciyexFDocsToc', "Documents"), settings: ['ciyex.fields.documents'] },
				{ id: 'ciyex/fieldConfig/referrals', label: localize('ciyexFRefToc', "Referrals"), settings: ['ciyex.fields.referrals'] },
				{ id: 'ciyex/fieldConfig/history', label: localize('ciyexFHistToc', "History"), settings: ['ciyex.fields.history'] },
				{ id: 'ciyex/fieldConfig/visitNotes', label: localize('ciyexFNotesToc', "Visit Notes"), settings: ['ciyex.fields.visitNotes'] },
				{ id: 'ciyex/fieldConfig/practice', label: localize('ciyexFPracToc', "Practice"), settings: ['ciyex.fields.practice'] },
				{ id: 'ciyex/fieldConfig/referralProviders', label: localize('ciyexFRefProvToc', "Referral Providers"), settings: ['ciyex.fields.referralProviders'] },
				{ id: 'ciyex/fieldConfig/referralPractices', label: localize('ciyexFRefPracToc', "Referral Practices"), settings: ['ciyex.fields.referralPractices'] },
			]
		},
		// VS Code developer settings hidden for EHR users.
		// Uncomment below to restore for developers.
		/*
		{
			id: 'editor',
			label: localize('textEditor', "Text Editor"),
			settings: ['editor.*'],
			children: [
				{
					id: 'editor/cursor',
					label: localize('cursor', "Cursor"),
					settings: ['editor.cursor*']
				},
				{
					id: 'editor/find',
					label: localize('find', "Find"),
					settings: ['editor.find.*']
				},
				{
					id: 'editor/font',
					label: localize('font', "Font"),
					settings: ['editor.font*']
				},
				{
					id: 'editor/format',
					label: localize('formatting', "Formatting"),
					settings: ['editor.format*']
				},
				{
					id: 'editor/diffEditor',
					label: localize('diffEditor', "Diff Editor"),
					settings: ['diffEditor.*']
				},
				{
					id: 'editor/multiDiffEditor',
					label: localize('multiDiffEditor', "Multi-File Diff Editor"),
					settings: ['multiDiffEditor.*']
				},
				{
					id: 'editor/minimap',
					label: localize('minimap', "Minimap"),
					settings: ['editor.minimap.*']
				},
				{
					id: 'editor/suggestions',
					label: localize('suggestions', "Suggestions"),
					settings: ['editor.*suggest*']
				},
				{
					id: 'editor/files',
					label: localize('files', "Files"),
					settings: ['files.*']
				}
			]
		},
		{
			id: 'workbench',
			label: localize('workbench', "Workbench"),
			settings: ['workbench.*'],
			children: [
				{
					id: 'workbench/appearance',
					label: localize('appearance', "Appearance"),
					settings: ['workbench.activityBar.*', 'workbench.*color*', 'workbench.fontAliasing', 'workbench.iconTheme', 'workbench.sidebar.location', 'workbench.*.visible', 'workbench.tips.enabled', 'workbench.tree.*', 'workbench.view.*']
				},
				{
					id: 'workbench/breadcrumbs',
					label: localize('breadcrumbs', "Breadcrumbs"),
					settings: ['breadcrumbs.*']
				},
				{
					id: 'workbench/editor',
					label: localize('editorManagement', "Editor Management"),
					settings: ['workbench.editor.*']
				},
				{
					id: 'workbench/settings',
					label: localize('settings', "Settings Editor"),
					settings: ['workbench.settings.*']
				},
				{
					id: 'workbench/zenmode',
					label: localize('zenMode', "Zen Mode"),
					settings: ['zenmode.*']
				},
				{
					id: 'workbench/screencastmode',
					label: localize('screencastMode', "Screencast Mode"),
					settings: ['screencastMode.*']
				},
				{
					id: 'workbench/browser',
					label: localize('browser', "Browser"),
					settings: ['workbench.browser.*']
				}
			]
		},
		{
			id: 'window',
			label: localize('window', "Window"),
			settings: ['window.*'],
			children: [
				{
					id: 'window/newWindow',
					label: localize('newWindow', "New Window"),
					settings: ['window.*newwindow*']
				}
			]
		},
		{
			id: 'chat',
			label: localize('chat', "Chat"),
			children: [
				{
					id: 'chat/agent',
					label: localize('chatAgent', "Agent"),
					settings: [
						'chat.agent.*',
						'chat.checkpoints.*',
						'chat.editRequests',
						'chat.requestQueuing.*',
						'chat.undoRequests.*',
						'chat.customAgentInSubagent.*',
						'chat.editing.autoAcceptDelay',
						'chat.editing.confirmEditRequest*',
						'chat.planAgent.defaultModel'
					]
				},
				{
					id: 'chat/appearance',
					label: localize('chatAppearance', "Appearance"),
					settings: [
						'chat.editor.*',
						'chat.fontFamily',
						'chat.fontSize',
						'chat.math.*',
						'chat.agentsControl.*',
						'chat.alternativeToolAction.*',
						'chat.codeBlock.*',
						'chat.editing.explainChanges.enabled',
						'chat.editMode.hidden',
						'chat.editorAssociations',
						'chat.extensionUnification.*',
						'chat.inlineReferences.*',
						'chat.notifyWindow*',
						'chat.statusWidget.*',
						'chat.tips.*',
						'chat.unifiedAgentsBar.*',
						'accessibility.signals.chatUserActionRequired',
						'accessibility.signals.chatResponseReceived'
					]
				},
				{
					id: 'chat/sessions',
					label: localize('chatSessions', "Sessions"),
					settings: [
						'chat.agentSessionProjection.*',
						'chat.sessions.*',
						'chat.viewProgressBadge.*',
						'chat.viewSessions.*',
						'chat.restoreLastPanelSession',
						'chat.exitAfterDelegation',
						'chat.repoInfo.*'
					]
				},
				{
					id: 'chat/tools',
					label: localize('chatTools', "Tools"),
					settings: [
						'chat.tools.*',
						'chat.extensionTools.*'
					]
				},
				{
					id: 'chat/mcp',
					label: localize('chatMcp', "MCP"),
					settings: ['mcp', 'chat.mcp.*', 'mcp.*']
				},
				{
					id: 'chat/context',
					label: localize('chatContext', "Context"),
					settings: [
						'chat.detectParticipant.*',
						'chat.experimental.detectParticipant.*',
						'chat.implicitContext.*',
						'chat.promptFilesLocations',
						'chat.instructionsFilesLocations',
						'chat.modeFilesLocations',
						'chat.agentFilesLocations',
						'chat.agentSkillsLocations',
						'chat.hookFilesLocations',
						'chat.promptFilesRecommendations',
						'chat.useAgentsMdFile',
						'chat.useNestedAgentsMdFiles',
						'chat.useAgentSkills',
						'chat.experimental.useSkillAdherencePrompt',
						'chat.useHooks',
						'chat.includeApplyingInstructions',
						'chat.includeReferencedInstructions',
						'chat.sendElementsToChat.*',
						'chat.useClaudeMdFile'
					]
				},
				{
					id: 'chat/inlineChat',
					label: localize('chatInlineChat', "Inline Chat"),
					settings: ['inlineChat.*']
				},
				{
					id: 'chat/miscellaneous',
					label: localize('chatMiscellaneous', "Miscellaneous"),
					settings: [
						'chat.disableAIFeatures',
						'chat.allowAnonymousAccess'
					]
				},
			]
		},
		{
			id: 'features',
			label: localize('features', "Features"),
			children: [
				{
					id: 'features/accessibilitySignals',
					label: localize('accessibility.signals', 'Accessibility Signals'),
					settings: ['accessibility.signal*']
				},
				{
					id: 'features/accessibility',
					label: localize('accessibility', "Accessibility"),
					settings: ['accessibility.*']
				},
				{
					id: 'features/explorer',
					label: localize('fileExplorer', "Explorer"),
					settings: ['explorer.*', 'outline.*']
				},
				{
					id: 'features/search',
					label: localize('search', "Search"),
					settings: ['search.*']
				},
				{
					id: 'features/debug',
					label: localize('debug', "Debug"),
					settings: ['debug.*', 'launch']
				},
				{
					id: 'features/testing',
					label: localize('testing', "Testing"),
					settings: ['testing.*']
				},
				{
					id: 'features/scm',
					label: localize('scm', "Source Control"),
					settings: ['scm.*']
				},
				{
					id: 'features/extensions',
					label: localize('extensions', "Extensions"),
					settings: ['extensions.*']
				},
				{
					id: 'features/terminal',
					label: localize('terminal', "Terminal"),
					settings: ['terminal.*']
				},
				{
					id: 'features/task',
					label: localize('task', "Task"),
					settings: ['task.*']
				},
				{
					id: 'features/problems',
					label: localize('problems', "Problems"),
					settings: ['problems.*']
				},
				{
					id: 'features/output',
					label: localize('output', "Output"),
					settings: ['output.*']
				},
				{
					id: 'features/comments',
					label: localize('comments', "Comments"),
					settings: ['comments.*']
				},
				{
					id: 'features/remote',
					label: localize('remote', "Remote"),
					settings: ['remote.*']
				},
				{
					id: 'features/timeline',
					label: localize('timeline', "Timeline"),
					settings: ['timeline.*']
				},
				{
					id: 'features/notebook',
					label: localize('notebook', 'Notebook'),
					settings: ['notebook.*', 'interactiveWindow.*']
				},
				{
					id: 'features/mergeEditor',
					label: localize('mergeEditor', 'Merge Editor'),
					settings: ['mergeEditor.*']
				},
				{
					id: 'features/issueReporter',
					label: localize('issueReporter', 'Issue Reporter'),
					settings: ['issueReporter.*'],
					hide: !isWeb
				}
			]
		},
		{
			id: 'application',
			label: localize('application', "Application"),
			children: [
				{
					id: 'application/http',
					label: localize('proxy', "Proxy"),
					settings: ['http.*']
				},
				{
					id: 'application/keyboard',
					label: localize('keyboard', "Keyboard"),
					settings: ['keyboard.*']
				},
				{
					id: 'application/update',
					label: localize('update', "Update"),
					settings: ['update.*']
				},
				{
					id: 'application/telemetry',
					label: localize('telemetry', "Telemetry"),
					settings: ['telemetry.*']
				},
				{
					id: 'application/settingsSync',
					label: localize('settingsSync', "Settings Sync"),
					settings: ['settingsSync.*']
				},
				{
					id: 'application/network',
					label: localize('network', "Network"),
					settings: ['network.*']
				},
				{
					id: 'application/experimental',
					label: localize('experimental', "Experimental"),
					settings: ['application.experimental.*']
				},
				{
					id: 'application/other',
					label: localize('other', "Other"),
					settings: ['application.*'],
					hide: isWindows
				}
			]
		},
		{
			id: 'security',
			label: localize('security', "Security"),
			settings: ['security.*'],
			children: [
				{
					id: 'security/workspace',
					label: localize('workspace', "Workspace"),
					settings: ['security.workspace.*']
				}
			]
		}
		*/
	]
};
