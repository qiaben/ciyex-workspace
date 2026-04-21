/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { DeveloperPortalEditorInput } from '../editors/ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

const DEV_ITEMS: Array<{ icon: string; label: string; description: string; section: string }> = [
	// allow-any-unicode-next-line
	{ icon: '🔑', label: 'API Keys', description: 'Manage API keys for authenticating your apps', section: 'api-keys' },
	// allow-any-unicode-next-line
	{ icon: '📤', label: 'App Submissions', description: 'Submit new apps or updates for review', section: 'submissions' },
	// allow-any-unicode-next-line
	{ icon: '🧪', label: 'Sandboxes', description: 'FHIR sandbox environments for testing', section: 'sandboxes' },
	// allow-any-unicode-next-line
	{ icon: '👥', label: 'Team', description: 'Manage your vendor team members', section: 'team' },
	// allow-any-unicode-next-line
	{ icon: '📊', label: 'Analytics', description: 'Track app performance, revenue, subscribers', section: 'analytics' },
	// allow-any-unicode-next-line
	{ icon: '🔔', label: 'Webhook Logs', description: 'View webhook delivery history and debug', section: 'webhook-logs' },
	// allow-any-unicode-next-line
	{ icon: '✅', label: 'Review Queue', description: 'Admin: review and approve app submissions', section: 'review-queue' },
];

export class DeveloperMenuPane extends ViewPane {
	static readonly ID = 'ciyex.developer.menu';

	private container!: HTMLElement;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.developer-menu-pane'));
		this.container.style.cssText = 'height:100%;overflow-y:auto;font-size:12px;';

		// Overview button
		const overviewRow = DOM.append(this.container, DOM.$('div'));
		overviewRow.style.cssText = 'padding:10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.1);';
		overviewRow.addEventListener('mouseenter', () => { overviewRow.style.background = 'var(--vscode-list-hoverBackground)'; });
		overviewRow.addEventListener('mouseleave', () => { overviewRow.style.background = ''; });
		overviewRow.addEventListener('click', () => {
			const input = new DeveloperPortalEditorInput('overview');
			this.editorService.openEditor(input, { pinned: true });
		});
		const overviewIcon = DOM.append(overviewRow, DOM.$('span'));
		overviewIcon.textContent = '</>';
		overviewIcon.style.cssText = 'font-size:14px;font-weight:700;width:24px;text-align:center;flex-shrink:0;color:var(--vscode-textLink-foreground);';
		const overviewCol = DOM.append(overviewRow, DOM.$('div'));
		overviewCol.style.flex = '1';
		const overviewLabel = DOM.append(overviewCol, DOM.$('div'));
		overviewLabel.textContent = 'Developer Portal';
		overviewLabel.style.cssText = 'font-weight:600;';
		const overviewDesc = DOM.append(overviewCol, DOM.$('div'));
		overviewDesc.textContent = 'Build and manage your Ciyex Hub apps';
		overviewDesc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

		// Section items
		for (const item of DEV_ITEMS) {
			const row = DOM.append(this.container, DOM.$('div'));
			row.style.cssText = 'padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(128,128,128,0.06);';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => {
				const input = new DeveloperPortalEditorInput(item.section);
				this.editorService.openEditor(input, { pinned: true });
			});

			const icon = DOM.append(row, DOM.$('span'));
			icon.textContent = item.icon;
			icon.style.cssText = 'font-size:16px;width:24px;text-align:center;flex-shrink:0;';

			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;min-width:0;';

			const label = DOM.append(col, DOM.$('div'));
			label.textContent = item.label;
			label.style.cssText = 'font-weight:500;';

			const desc = DOM.append(col, DOM.$('div'));
			desc.textContent = item.description;
			desc.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			const arrow = DOM.append(row, DOM.$('span'));
			// allow-any-unicode-next-line
			arrow.textContent = '›';
			arrow.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:16px;flex-shrink:0;';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
