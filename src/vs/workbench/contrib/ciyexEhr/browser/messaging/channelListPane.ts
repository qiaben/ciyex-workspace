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
import { ICiyexApiService } from '../ciyexApiService.js';
import { MessagingEditorInput } from '../editors/ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface Channel {
	id: string;
	name: string;
	type: 'public' | 'private' | 'dm' | 'group_dm';
	topic?: string;
	unreadCount?: number;
	lastMessage?: { content: string; senderName: string; createdAt: string };
	members?: Array<{ displayName: string }>;
}

export class ChannelListPane extends ViewPane {
	static readonly ID = 'ciyex.messaging.channels';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private channels: Channel[] = [];
	private loaded = false;
	private searchValue = '';

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
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.channel-list-pane'));
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;';

		// Toolbar
		const toolbar = DOM.append(this.container, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		const search = DOM.append(toolbar, DOM.$('input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Search channels...';
		search.style.cssText = 'flex:1;padding:3px 6px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;box-sizing:border-box;';
		search.addEventListener('input', () => { this.searchValue = search.value; this._renderList(); });

		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+';
		addBtn.title = 'New Channel / DM';
		addBtn.style.cssText = 'padding:2px 6px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:12px;height:24px;width:24px;';
		addBtn.addEventListener('click', () => this._createChannel());

		// List
		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._loadChannels();
		const retry = setInterval(() => {
			if (this.loaded) { clearInterval(retry); return; }
			this._loadChannels();
		}, 3000);

		// Poll unread every 30s
		setInterval(() => { if (this.loaded) { this._loadChannels(); } }, 30000);
	}

	private async _loadChannels(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/channels');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.channels = (data?.data || data?.content || data || []) as Channel[];
			this.loaded = true;
			this._renderList();
		} catch {
			this.listEl.textContent = 'Waiting for login...';
		}
	}

	private _renderList(): void {
		DOM.clearNode(this.listEl);
		const q = this.searchValue.toLowerCase();

		const filtered = this.channels.filter(ch => {
			if (!q) { return true; }
			return ch.name.toLowerCase().includes(q);
		});

		const publicChannels = filtered.filter(ch => ch.type === 'public' || ch.type === 'private');
		const dms = filtered.filter(ch => ch.type === 'dm' || ch.type === 'group_dm');

		// CHANNELS section
		if (publicChannels.length > 0 || !q) {
			this._renderSection('CHANNELS', publicChannels);
		}

		// DIRECT MESSAGES section
		if (dms.length > 0 || !q) {
			this._renderSection('DIRECT MESSAGES', dms);
		}

		if (filtered.length === 0) {
			const empty = DOM.append(this.listEl, DOM.$('div'));
			empty.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
			empty.textContent = this.channels.length === 0 ? 'No channels' : 'No matches';
		}
	}

	private _renderSection(title: string, channels: Channel[]): void {
		// Section header
		const header = DOM.append(this.listEl, DOM.$('div'));
		header.style.cssText = 'padding:8px 10px 4px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);letter-spacing:0.5px;';
		header.textContent = title;

		for (const ch of channels) {
			const row = DOM.append(this.listEl, DOM.$('div'));
			const hasUnread = (ch.unreadCount || 0) > 0;
			row.style.cssText = `padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;${hasUnread ? 'font-weight:600;' : ''}`;
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });

			if (ch.type === 'dm' || ch.type === 'group_dm') {
				// Avatar for DMs
				const initials = ch.name.split(' ').map(w => (w[0] || '')).join('').substring(0, 2).toUpperCase() || '?';
				const hue = Math.abs(ch.name.split('').reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0)) % 360;
				const av = DOM.append(row, DOM.$('span'));
				av.textContent = initials;
				av.style.cssText = `width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;color:#fff;flex-shrink:0;background:hsl(${hue},45%,45%);`;
			} else {
				// # icon for channels
				const icon = DOM.append(row, DOM.$('span'));
				icon.textContent = ch.type === 'private' ? '🔒' : '#';
				icon.style.cssText = 'width:22px;text-align:center;flex-shrink:0;font-weight:600;color:var(--vscode-descriptionForeground);';
			}

			// Name + preview column
			const col = DOM.append(row, DOM.$('div'));
			col.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

			const nameEl = DOM.append(col, DOM.$('div'));
			nameEl.textContent = ch.name;
			nameEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;';

			if (ch.lastMessage) {
				const preview = DOM.append(col, DOM.$('div'));
				preview.textContent = `${ch.lastMessage.senderName}: ${ch.lastMessage.content}`;
				preview.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--vscode-descriptionForeground);font-weight:400;';
			}

			// Right side: unread badge + time
			const right = DOM.append(row, DOM.$('div'));
			right.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex-shrink:0;';

			if (ch.lastMessage) {
				const time = DOM.append(right, DOM.$('span'));
				try {
					time.textContent = new Date(ch.lastMessage.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
				} catch {
					time.textContent = '';
				}
				time.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);font-weight:400;';
			}

			if (hasUnread) {
				const badge = DOM.append(right, DOM.$('span'));
				badge.textContent = String(ch.unreadCount);
				badge.style.cssText = 'font-size:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);padding:1px 5px;border-radius:8px;font-weight:600;';
			}

			// Click → open in editor
			row.addEventListener('click', () => {
				const input = new MessagingEditorInput(ch.id, ch.name, ch.type);
				this.editorService.openEditor(input, { pinned: true });
			});
		}
	}

	private async _createChannel(): Promise<void> {
		// Quick pick: Channel or DM
		const choice = await new Promise<string | undefined>(resolve => {
			const picker = DOM.append(this.container, DOM.$('div'));
			picker.style.cssText = 'position:absolute;top:60px;left:8px;right:8px;background:var(--vscode-quickInput-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:4px;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

			for (const [label, value] of [['# New Channel', 'channel'], ['👤 New Direct Message', 'dm']]) {
				const item = DOM.append(picker, DOM.$('div'));
				item.textContent = label;
				item.style.cssText = 'padding:6px 10px;cursor:pointer;border-radius:4px;font-size:12px;';
				item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
				item.addEventListener('mouseleave', () => { item.style.background = ''; });
				item.addEventListener('click', () => { picker.remove(); resolve(value); });
			}

			// Click outside to dismiss
			const dismiss = () => { picker.remove(); resolve(undefined); };
			setTimeout(() => document.addEventListener('click', dismiss, { once: true }), 100);
		});

		if (!choice) { return; }

		if (choice === 'channel') {
			// Prompt for channel name
			const nameInput = prompt('Channel name:');
			if (!nameInput) { return; }

			try {
				const res = await this.apiService.fetch('/api/channels', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ name: nameInput, type: 'public' }),
				});
				if (res.ok) {
					const data = await res.json();
					const ch = data?.data || data;
					await this._loadChannels();
					const input = new MessagingEditorInput(ch.id, ch.name, ch.type || 'public');
					this.editorService.openEditor(input, { pinned: true });
				}
			} catch { /* failed */ }
		} else {
			// DM: prompt for email
			const email = prompt('User email for DM:');
			if (!email) { return; }

			try {
				const res = await this.apiService.fetch('/api/channels/dm', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email }),
				});
				if (res.ok) {
					const data = await res.json();
					const ch = data?.data || data;
					await this._loadChannels();
					const input = new MessagingEditorInput(ch.id, ch.name || email, 'dm');
					this.editorService.openEditor(input, { pinned: true });
				}
			} catch { /* failed */ }
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
