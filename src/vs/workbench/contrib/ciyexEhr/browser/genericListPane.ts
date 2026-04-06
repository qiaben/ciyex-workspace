/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewPaneOptions, ViewPane } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

/**
 * Configuration for a generic EHR list pane.
 */
export interface IGenericListConfig {
	apiPath: string;
	columns: Array<{
		key: string;
		label?: string;
		width?: string;
	}>;
	onClickCommand?: string;
	onClickIdField?: string;
	onClickLabelField?: string;
	emptyMessage?: string;
	iconId?: string;
	avatarFields?: [string, string]; // [firstNameField, lastNameField] for avatar circle
}

/**
 * A reusable ViewPane that fetches a list from an API endpoint and renders rows.
 * Used for Encounters, Labs, Prescriptions, Immunizations, etc.
 */
export class GenericListPane extends ViewPane {

	private _listEl: HTMLElement | undefined;
	private _config: IGenericListConfig;

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
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Configuration is set via a static registry keyed by view ID
		this._config = GenericListPane.configs.get(options.id) || {
			apiPath: '/api/patients',
			columns: [{ key: 'name' }],
		};
	}

	// Static config registry - set before view is instantiated
	static readonly configs = new Map<string, IGenericListConfig>();

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		container.style.overflow = 'auto';

		const loadingEl = document.createElement('div');
		loadingEl.style.padding = '12px 16px';
		loadingEl.style.color = 'var(--vscode-descriptionForeground)';
		loadingEl.style.fontSize = '12px';
		loadingEl.textContent = 'Loading...';
		container.appendChild(loadingEl);

		this._listEl = document.createElement('div');
		container.appendChild(this._listEl);

		this._loadData().then(() => loadingEl.remove());
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private async _loadData(): Promise<void> {
		try {
			const response = await this.apiService.fetch(`${this._config.apiPath}?page=0&size=100`);
			if (!response.ok) {
				this._showMsg(`Failed to load (${response.status})`);
				return;
			}
			const data = await response.json();
			const items = data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : []);
			if (items.length === 0) {
				this._showMsg(this._config.emptyMessage || 'No items found');
				return;
			}
			this._renderItems(items);
		} catch {
			this._showMsg('Unable to connect to server');
		}
	}

	private _renderItems(items: Record<string, unknown>[]): void {
		if (!this._listEl) {
			return;
		}

		for (const item of items) {
			const row = document.createElement('div');
			Object.assign(row.style, {
				padding: '6px 16px', cursor: 'pointer', display: 'flex',
				alignItems: 'center', gap: '8px', fontSize: '12px',
				borderBottom: '1px solid var(--vscode-list-hoverBackground, rgba(255,255,255,0.04))',
			});
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			// Avatar or icon
			if (this._config.avatarFields) {
				const [fnField, lnField] = this._config.avatarFields;
				const fn = String(item[fnField] || '');
				const ln = String(item[lnField] || '');
				const initials = `${fn[0] || ''}${ln[0] || ''}`.toUpperCase();
				const hue = ((fn.charCodeAt(0) || 0) * 7 + (ln.charCodeAt(0) || 0) * 13) % 360;
				const av = document.createElement('span');
				Object.assign(av.style, {
					width: '22px', height: '22px', borderRadius: '50%',
					display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
					fontSize: '9px', fontWeight: '600', color: '#fff', flexShrink: '0',
					background: `hsl(${hue}, 50%, 40%)`,
				});
				av.textContent = initials;
				row.appendChild(av);
			} else if (this._config.iconId) {
				const icon = document.createElement('span');
				icon.className = `codicon codicon-${this._config.iconId}`;
				icon.style.opacity = '0.6';
				row.appendChild(icon);
			}

			// Columns
			for (let i = 0; i < this._config.columns.length; i++) {
				const col = this._config.columns[i];
				const val = this._resolveValue(item, col.key);
				const span = document.createElement('span');
				span.textContent = val;
				if (i === 0) {
					span.style.flex = '1';
					span.style.color = 'var(--vscode-foreground)';
				} else {
					span.style.color = 'var(--vscode-descriptionForeground)';
					span.style.fontSize = '11px';
					span.style.whiteSpace = 'nowrap';
					if (col.width) {
						span.style.width = col.width;
					}
				}
				row.appendChild(span);
			}

			// Click handler
			if (this._config.onClickCommand) {
				const id = String(item[this._config.onClickIdField || 'id'] || '');
				const label = String(item[this._config.onClickLabelField || 'name'] || '');
				row.addEventListener('click', () => {
					this.commandService.executeCommand(this._config.onClickCommand!, id, label);
				});
			}

			this._listEl.appendChild(row);
		}
	}

	private _resolveValue(item: Record<string, unknown>, key: string): string {
		const val = item[key];
		if (val === null || val === undefined) {
			return '';
		}
		return String(val);
	}

	private _showMsg(msg: string): void {
		if (!this._listEl) {
			return;
		}
		const el = document.createElement('div');
		el.style.padding = '12px 16px';
		el.style.color = 'var(--vscode-descriptionForeground)';
		el.style.fontSize = '12px';
		el.textContent = msg;
		this._listEl.appendChild(el);
	}
}
