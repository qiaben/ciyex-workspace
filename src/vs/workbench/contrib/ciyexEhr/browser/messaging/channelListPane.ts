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
import { mainWindow } from '../../../../../base/browser/window.js';
import { createOverflowMenuButton, createRowActionsContainer, IOverflowMenuItem } from '../sidebarActions.js';

interface Channel {
	id: string;
	name: string;
	type: 'public' | 'private' | 'dm' | 'group_dm';
	topic?: string;
	unreadCount?: number;
	mentionsCount?: number;
	pinned?: boolean;
	muted?: boolean;
	lastMessage?: { content: string; senderName: string; createdAt: string };
	members?: Array<{ displayName: string; status?: 'online' | 'offline' | 'away' | 'busy' }>;
	otherUserStatus?: 'online' | 'offline' | 'away' | 'busy';
}

type ChannelFilter = 'all' | 'unread' | 'mentions' | 'pinned';

const STATUS_COLORS: Record<string, string> = {
	online: '#22c55e',
	away: '#f59e0b',
	busy: '#ef4444',
	offline: '#6b7280',
};

export class ChannelListPane extends ViewPane {
	static readonly ID = 'ciyex.messaging.channels';

	private container!: HTMLElement;
	private listEl!: HTMLElement;
	private searchInput?: HTMLInputElement;
	private filterTabsEl?: HTMLElement;
	private channels: Channel[] = [];
	private loaded = false;
	private searchValue = '';
	private filter: ChannelFilter = 'all';

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
		this.container.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:12px;position:relative;';

		// Toolbar header — title is already shown by the VS Code view container + view pane headers.
		const header = DOM.append(this.container, DOM.$('div'));
		header.style.cssText = 'display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);align-items:center;justify-content:flex-end;flex-shrink:0;';

		this._headerBtn(header, '\u{1F50D}', 'Search Messages', () => { this.searchInput?.focus(); });
		this._headerBtn(header, '+', 'New Channel / DM', () => this._createChannel());

		// Search row
		const searchRow = DOM.append(this.container, DOM.$('div'));
		searchRow.style.cssText = 'padding:4px 10px 6px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const search = DOM.append(searchRow, DOM.$('input')) as HTMLInputElement;
		this.searchInput = search;
		search.type = 'text';
		search.placeholder = 'Search channels and users...';
		search.style.cssText = 'width:100%;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;height:24px;box-sizing:border-box;';
		search.addEventListener('input', () => { this.searchValue = search.value; this._renderList(); });

		// Filter tabs
		this._renderFilterTabs();

		// List
		this.listEl = DOM.append(this.container, DOM.$('div'));
		this.listEl.style.cssText = 'flex:1;overflow-y:auto;';
		this.listEl.textContent = 'Loading...';

		this._loadChannels();
		const retry = mainWindow.setInterval(() => {
			if (this.loaded) { mainWindow.clearInterval(retry); return; }
			this._loadChannels();
		}, 3000);

		mainWindow.setInterval(() => { if (this.loaded) { this._loadChannels(); } }, 30000);
	}

	private _headerBtn(parent: HTMLElement, symbol: string, label: string, fn: () => void): void {
		const btn = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		btn.textContent = symbol;
		btn.title = label;
		btn.style.cssText = 'padding:2px 6px;border:none;border-radius:3px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);height:24px;min-width:24px;';
		btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-list-hoverBackground)'; });
		btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
		btn.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
	}

	private _renderFilterTabs(): void {
		// Remove the previously rendered filter bar (if any) and create a fresh one.
		this.filterTabsEl?.remove();
		const bar = DOM.$('.filter-tabs') as HTMLElement;
		this.filterTabsEl = bar;
		bar.style.cssText = 'display:flex;gap:2px;padding:4px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';

		const unreadCount = this.channels.filter(c => (c.unreadCount || 0) > 0).length;
		const mentionsCount = this.channels.filter(c => (c.mentionsCount || 0) > 0).length;

		const filters: Array<{ id: ChannelFilter; label: string; badge?: number }> = [
			{ id: 'all', label: 'All' },
			{ id: 'unread', label: 'Unread', badge: unreadCount > 0 ? unreadCount : undefined },
			{ id: 'mentions', label: '@', badge: mentionsCount > 0 ? mentionsCount : undefined },
			{ id: 'pinned', label: 'Pinned' },
		];

		for (const f of filters) {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			const isActive = this.filter === f.id;
			btn.style.cssText = `flex:1;padding:3px 6px;border:none;border-radius:3px;cursor:pointer;font-size:10px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:4px;${isActive ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);' : 'background:transparent;color:var(--vscode-descriptionForeground);'}`;

			const lbl = DOM.append(btn, DOM.$('span'));
			lbl.textContent = f.label;

			if (typeof f.badge === 'number') {
				const badge = DOM.append(btn, DOM.$('span'));
				badge.textContent = String(f.badge);
				badge.style.cssText = `font-size:9px;padding:0 5px;border-radius:8px;background:${isActive ? 'rgba(255,255,255,0.25)' : '#ef4444'};color:#fff;font-weight:600;`;
			}

			btn.addEventListener('click', () => { this.filter = f.id; this._renderFilterTabs(); this._renderList(); });
		}

		// Insert after the search row (3rd child)
		const searchRow = this.container.children[1];
		if (searchRow && searchRow.nextSibling) {
			this.container.insertBefore(bar, searchRow.nextSibling);
		} else {
			this.container.appendChild(bar);
		}
	}

	private async _loadChannels(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/channels');
			if (!res.ok) { this.listEl.textContent = 'Waiting for login...'; return; }
			const data = await res.json();
			this.channels = (data?.data || data?.content || data || []) as Channel[];
			this.loaded = true;
			this._renderFilterTabs();
			this._renderList();
		} catch {
			this.listEl.textContent = 'Waiting for login...';
		}
	}

	private _renderList(): void {
		DOM.clearNode(this.listEl);
		const q = this.searchValue.toLowerCase();

		let filtered = this.channels.filter(ch => {
			if (!q) { return true; }
			return ch.name.toLowerCase().includes(q);
		});

		if (this.filter === 'unread') {
			filtered = filtered.filter(c => (c.unreadCount || 0) > 0);
		} else if (this.filter === 'mentions') {
			filtered = filtered.filter(c => (c.mentionsCount || 0) > 0);
		} else if (this.filter === 'pinned') {
			filtered = filtered.filter(c => c.pinned);
		}

		const publicChannels = filtered.filter(ch => ch.type === 'public' || ch.type === 'private');
		const dms = filtered.filter(ch => ch.type === 'dm' || ch.type === 'group_dm');

		if (publicChannels.length > 0 || (!q && this.filter === 'all')) {
			this._renderSection('CHANNELS', publicChannels);
		}

		if (dms.length > 0 || (!q && this.filter === 'all')) {
			this._renderSection('DIRECT MESSAGES', dms);
		}

		if (filtered.length === 0) {
			const empty = DOM.append(this.listEl, DOM.$('div'));
			empty.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);font-size:12px;';
			empty.textContent = this.channels.length === 0 ? 'No channels' : 'No matches';
		}
	}

	private _renderSection(title: string, channels: Channel[]): void {
		const header = DOM.append(this.listEl, DOM.$('div'));
		header.style.cssText = 'padding:8px 10px 4px;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--vscode-descriptionForeground);letter-spacing:0.5px;display:flex;align-items:center;gap:6px;';
		const t = DOM.append(header, DOM.$('span'));
		t.textContent = title;
		t.style.cssText = 'flex:1;';
		const addBtn = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+';
		addBtn.title = title === 'CHANNELS' ? 'New Channel' : 'New DM';
		addBtn.style.cssText = 'padding:0 6px;border:none;border-radius:3px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-descriptionForeground);height:16px;line-height:16px;';
		addBtn.addEventListener('mouseenter', () => { addBtn.style.background = 'var(--vscode-list-hoverBackground)'; });
		addBtn.addEventListener('mouseleave', () => { addBtn.style.background = 'transparent'; });
		addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._createChannel(); });

		for (const ch of channels) {
			this._renderChannelRow(ch);
		}
	}

	private _renderChannelRow(ch: Channel): void {
		const row = DOM.append(this.listEl, DOM.$('div'));
		const hasUnread = (ch.unreadCount || 0) > 0;
		const hasMention = (ch.mentionsCount || 0) > 0;
		row.style.cssText = `padding:6px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;position:relative;${hasUnread ? 'font-weight:600;' : ''}`;

		if (ch.type === 'dm' || ch.type === 'group_dm') {
			// Avatar with status dot
			const avWrap = DOM.append(row, DOM.$('div'));
			avWrap.style.cssText = 'position:relative;flex-shrink:0;width:22px;height:22px;';

			const initials = ch.name.split(' ').map(w => (w[0] || '')).join('').substring(0, 2).toUpperCase() || '?';
			const hue = Math.abs(ch.name.split('').reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0)) % 360;
			const av = DOM.append(avWrap, DOM.$('span'));
			av.textContent = initials;
			av.style.cssText = `width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;color:#fff;background:hsl(${hue},45%,45%);`;

			// Status indicator dot
			const status = ch.otherUserStatus || (ch.members?.[0]?.status) || 'offline';
			const dot = DOM.append(avWrap, DOM.$('span'));
			dot.style.cssText = `position:absolute;bottom:-1px;right:-1px;width:8px;height:8px;border-radius:50%;background:${STATUS_COLORS[status]};border:2px solid var(--vscode-sideBar-background, #252526);`;
			dot.title = status.charAt(0).toUpperCase() + status.slice(1);
		} else {
			const icon = DOM.append(row, DOM.$('span'));
			// allow-any-unicode-next-line
			icon.textContent = ch.type === 'private' ? '\u{1F512}' : '#';
			icon.style.cssText = 'width:22px;text-align:center;flex-shrink:0;font-weight:600;color:var(--vscode-descriptionForeground);';
		}

		// Name + preview column
		const col = DOM.append(row, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;overflow:hidden;';

		const nameRow = DOM.append(col, DOM.$('div'));
		nameRow.style.cssText = 'display:flex;align-items:center;gap:4px;';

		const nameEl = DOM.append(nameRow, DOM.$('span'));
		nameEl.textContent = ch.name;
		nameEl.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;flex:1;';

		if (ch.pinned) {
			const pin = DOM.append(nameRow, DOM.$('span'));
			// allow-any-unicode-next-line
			pin.textContent = '\u{1F4CC}';
			pin.style.cssText = 'font-size:9px;flex-shrink:0;';
			pin.title = 'Pinned';
		}
		if (ch.muted) {
			const mute = DOM.append(nameRow, DOM.$('span'));
			// allow-any-unicode-next-line
			mute.textContent = '\u{1F507}';
			mute.style.cssText = 'font-size:9px;flex-shrink:0;opacity:0.6;';
			mute.title = 'Muted';
		}

		if (ch.lastMessage) {
			const preview = DOM.append(col, DOM.$('div'));
			preview.textContent = `${ch.lastMessage.senderName}: ${ch.lastMessage.content}`;
			preview.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--vscode-descriptionForeground);font-weight:400;';
		}

		// Right side: badges + time
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

		if (hasMention) {
			const badge = DOM.append(right, DOM.$('span'));
			badge.textContent = `@${ch.mentionsCount}`;
			badge.style.cssText = 'font-size:9px;background:#ef4444;color:#fff;padding:1px 5px;border-radius:8px;font-weight:600;';
		} else if (hasUnread) {
			const badge = DOM.append(right, DOM.$('span'));
			badge.textContent = String(ch.unreadCount);
			badge.style.cssText = 'font-size:10px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);padding:1px 5px;border-radius:8px;font-weight:600;';
		}

		// ⋯ overflow menu — hidden until hover, opens outside the bar
		const actions = createRowActionsContainer(row);
		actions.style.cssText = 'display:flex;gap:2px;align-items:center;flex-shrink:0;opacity:0;transition:opacity 0.1s;';

		createOverflowMenuButton(actions, (): IOverflowMenuItem[] => [
			{ symbol: ch.pinned ? '\u{1F4CC}' : '\u{1F4CD}', label: ch.pinned ? 'Unpin' : 'Pin', onClick: () => this._togglePin(ch) },
			{ symbol: ch.muted ? '\u{1F515}' : '\u{1F507}', label: ch.muted ? 'Unmute' : 'Mute', onClick: () => this._toggleMute(ch) },
			{ symbol: '\u{2713}', label: 'Mark as Read', onClick: () => this._markRead(ch) },
			{ separator: true },
			{ symbol: '\u{1F4AC}', label: 'Open Channel', onClick: () => { const input = new MessagingEditorInput(ch.id, ch.name, ch.type); this.editorService.openEditor(input, { pinned: true }); } },
		]);

		row.addEventListener('mouseenter', () => {
			row.style.background = 'var(--vscode-list-hoverBackground)';
			actions.style.opacity = '1';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = '';
			actions.style.opacity = '0';
		});
		row.addEventListener('click', (e) => {
			if (actions.contains(e.target as Node)) { return; }
			const input = new MessagingEditorInput(ch.id, ch.name, ch.type);
			this.editorService.openEditor(input, { pinned: true });
		});
	}

	private async _togglePin(ch: Channel): Promise<void> {
		ch.pinned = !ch.pinned;
		this._renderList();
		try { await this.apiService.fetch(`/api/channels/${ch.id}/pin`, { method: 'PUT', body: JSON.stringify({ pinned: ch.pinned }) }); } catch { /* */ }
	}

	private async _toggleMute(ch: Channel): Promise<void> {
		ch.muted = !ch.muted;
		this._renderList();
		try { await this.apiService.fetch(`/api/channels/${ch.id}/mute`, { method: 'PUT', body: JSON.stringify({ muted: ch.muted }) }); } catch { /* */ }
	}

	private async _markRead(ch: Channel): Promise<void> {
		ch.unreadCount = 0;
		ch.mentionsCount = 0;
		this._renderFilterTabs();
		this._renderList();
		try { await this.apiService.fetch(`/api/channels/${ch.id}/read`, { method: 'PUT' }); } catch { /* */ }
	}

	private _formEl: HTMLElement | null = null;

	private _createChannel(): void {
		if (this._formEl) { this._formEl.remove(); this._formEl = null; return; }

		const form = DOM.append(this.container, DOM.$('div'));
		this._formEl = form;
		form.style.cssText = 'position:absolute;top:40px;left:0;right:0;background:var(--vscode-editorWidget-background,#252526);border-bottom:1px solid var(--vscode-editorWidget-border);padding:10px;z-index:50;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

		const inputStyle = 'width:100%;padding:5px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:12px;box-sizing:border-box;margin-bottom:6px;';

		const typeRow = DOM.append(form, DOM.$('div'));
		typeRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
		let selectedType = 'channel';
		const typeBtns: Array<{ btn: HTMLButtonElement; type: string }> = [];
		const refreshTypeBtns = () => {
			for (const entry of typeBtns) {
				const active = entry.type === selectedType;
				entry.btn.style.background = active ? 'var(--vscode-button-background)' : 'transparent';
				entry.btn.style.color = active ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)';
			}
		};
		const makeTypeBtn = (label: string, type: string) => {
			const btn = DOM.append(typeRow, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = label;
			const active = type === selectedType;
			btn.style.cssText = `flex:1;padding:4px 8px;border-radius:3px;font-size:11px;cursor:pointer;border:1px solid var(--vscode-editorWidget-border);background:${active ? 'var(--vscode-button-background)' : 'transparent'};color:${active ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)'};`;
			typeBtns.push({ btn, type });
			btn.addEventListener('click', () => {
				selectedType = type;
				refreshTypeBtns();
				nameLbl.textContent = selectedType === 'dm' ? 'User Email' : 'Channel Name';
			});
			return btn;
		};
		makeTypeBtn('# Channel', 'channel');
		makeTypeBtn('DM', 'dm');

		const nameLbl = DOM.append(form, DOM.$('label'));
		nameLbl.textContent = 'Channel Name';
		nameLbl.style.cssText = 'font-size:10px;font-weight:600;display:block;margin-bottom:3px;color:var(--vscode-descriptionForeground);';

		const nameInput = DOM.append(form, DOM.$('input')) as HTMLInputElement;
		nameInput.type = 'text';
		nameInput.placeholder = 'e.g. general';
		nameInput.style.cssText = inputStyle;
		nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { form.remove(); this._formEl = null; } if (e.key === 'Enter') { createBtn.click(); } });

		const errEl = DOM.append(form, DOM.$('div'));
		errEl.style.cssText = 'font-size:10px;color:#f48771;margin-bottom:4px;display:none;';

		const btnRow = DOM.append(form, DOM.$('div'));
		btnRow.style.cssText = 'display:flex;gap:6px;';

		const cancelBtn = DOM.append(btnRow, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'flex:1;padding:4px;border:1px solid var(--vscode-editorWidget-border);border-radius:3px;background:transparent;color:var(--vscode-foreground);font-size:11px;cursor:pointer;';
		cancelBtn.addEventListener('click', () => { form.remove(); this._formEl = null; });

		const createBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		createBtn.textContent = 'Create';
		createBtn.style.cssText = 'flex:1;padding:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;font-size:11px;cursor:pointer;font-weight:600;';
		createBtn.addEventListener('click', async () => {
			const value = nameInput.value.trim();
			if (!value) { errEl.textContent = 'This field is required'; errEl.style.display = 'block'; return; }
			errEl.style.display = 'none';
			createBtn.disabled = true;
			createBtn.textContent = '...';

			try {
				if (selectedType === 'channel') {
					const res = await this.apiService.fetch('/api/channels', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ name: value, type: 'public' }),
					});
					if (res.ok) {
						const data = await res.json();
						const ch = data?.data || data;
						form.remove(); this._formEl = null;
						await this._loadChannels();
						const inp = new MessagingEditorInput(ch.id, ch.name, ch.type || 'public');
						this.editorService.openEditor(inp, { pinned: true });
					} else {
						errEl.textContent = 'Failed to create channel';
						errEl.style.display = 'block';
					}
				} else {
					const res = await this.apiService.fetch('/api/channels/dm', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email: value }),
					});
					if (res.ok) {
						const data = await res.json();
						const ch = data?.data || data;
						form.remove(); this._formEl = null;
						await this._loadChannels();
						const inp = new MessagingEditorInput(ch.id, ch.name || value, 'dm');
						this.editorService.openEditor(inp, { pinned: true });
					} else {
						errEl.textContent = 'Failed to start DM — check user email';
						errEl.style.display = 'block';
					}
				}
			} catch {
				errEl.textContent = 'Network error';
				errEl.style.display = 'block';
			} finally {
				createBtn.disabled = false;
				createBtn.textContent = 'Create';
			}
		});

		setTimeout(() => nameInput.focus(), 50);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
