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
import { createOverflowMenuButton, createRowActionsContainer, IOverflowMenuItem, parseSavedRecord } from '../sidebarActions.js';

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

/** A searchable person (staff user or patient) that can be added as a channel member. */
interface MemberCandidate { id: string; name: string; detail: string; tag: 'Staff' | 'Patient' }

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
		addBtn.addEventListener('click', (e) => { e.stopPropagation(); this._createChannel(title === 'CHANNELS' ? 'channel' : 'dm'); });

		// Pinned chats float to the TOP of the section (1st place). Array.sort is
		// stable, so unpinned rows keep their existing order and pinned rows keep
		// theirs — pinning a chat from the ⋯ menu moves it straight to the top.
		const ordered = [...channels].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
		for (const ch of ordered) {
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

	/** Open the "Create a channel" / "Start a direct message" modal. Channel
	 *  mode shows the Public/Private type toggle, name, optional topic and —
	 *  for private channels — a members people-picker. DM mode collects a user
	 *  email. */
	private _createChannel(initialMode: 'channel' | 'dm' = 'channel'): void {
		if (this._formEl) { this._formEl.remove(); this._formEl = null; return; }

		// For a new direct message, route to the in-editor "New Message" people
		// picker (matches ciyex-ehr-ui: list providers/patients, select to start a
		// DM) instead of the legacy email-prompt modal. Opening a MessagingEditor
		// with an empty channelId triggers the picker (see messagingEditor.ts).
		if (initialMode === 'dm') {
			const input = new MessagingEditorInput('', 'New Message', 'dm');
			this.editorService.openEditor(input, { pinned: true });
			return;
		}

		const targetWindow = DOM.getWindow(this.container);
		// DM mode is handled above (routed to the people picker), so the modal
		// below only ever builds the channel-creation form.
		const isDm = false;

		// Full-window dimmed backdrop + centered modal card. Anchor it inside the
		// `.monaco-workbench` element rather than `document.body`: VS Code only
		// defines the `--vscode-*` theme custom properties under that selector, so
		// attaching to `body` would leave every `var(--vscode-…)` unresolved and
		// fall back to the hardcoded dark values — making the form dark regardless
		// of the active theme.
		const modalHost = DOM.findParentWithClass(this.container, 'monaco-workbench') ?? targetWindow.document.body;
		const overlay = DOM.append(modalHost, DOM.$('.ciyex-channel-modal-overlay'));
		this._formEl = overlay;
		overlay.style.cssText = 'position:fixed;inset:0;z-index:2600;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);';

		const close = () => { overlay.remove(); this._formEl = null; };
		overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { close(); } });

		const card = DOM.append(overlay, DOM.$('.ciyex-channel-modal'));
		card.style.cssText = 'width:460px;max-width:92vw;max-height:88vh;overflow:auto;background:var(--vscode-editorWidget-background,#1e1e1e);color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.4);box-sizing:border-box;';
		card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); } });

		// Header
		const header = DOM.append(card, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const title = DOM.append(header, DOM.$('span'));
		title.textContent = isDm ? 'Start a direct message' : 'Create a channel';
		title.style.cssText = 'font-size:16px;font-weight:700;';
		const closeBtn = DOM.append(header, DOM.$('span')) as HTMLElement;
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.title = 'Close';
		closeBtn.style.cssText = 'cursor:pointer;font-size:15px;color:var(--vscode-descriptionForeground);padding:2px 6px;border-radius:4px;';
		closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'var(--vscode-toolbar-hoverBackground)'; });
		closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = ''; });
		closeBtn.addEventListener('click', close);

		const body = DOM.append(card, DOM.$('div'));
		body.style.cssText = 'padding:18px 22px;';

		const labelStyle = 'font-size:12px;font-weight:600;display:block;margin-bottom:6px;';
		const inputStyle = 'width:100%;padding:9px 11px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';

		// ---- Channel type (Public / Private) ----
		let selectedType: 'public' | 'private' = 'private';
		const typeBtns: Array<{ btn: HTMLButtonElement; type: 'public' | 'private' }> = [];
		if (!isDm) {
			selectedType = 'public';
			const typeLbl = DOM.append(body, DOM.$('label'));
			typeLbl.textContent = 'Channel type';
			typeLbl.style.cssText = labelStyle;

			const typeRow = DOM.append(body, DOM.$('div'));
			typeRow.style.cssText = 'display:flex;gap:10px;margin-bottom:18px;';

			const makeTypeBtn = (label: string, icon: string, type: 'public' | 'private') => {
				const btn = DOM.append(typeRow, DOM.$('button')) as HTMLButtonElement;
				btn.textContent = `${icon}  ${label}`;
				btn.style.cssText = 'flex:1;padding:11px;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;';
				typeBtns.push({ btn, type });
				btn.addEventListener('click', () => { selectedType = type; refreshTypeBtns(); });
				return btn;
			};
			makeTypeBtn('Public', '#', 'public');
			makeTypeBtn('Private', '\u{1F512}', 'private');
		}
		const refreshTypeBtns = () => {
			for (const entry of typeBtns) {
				const active = entry.type === selectedType;
				entry.btn.style.border = `1px solid ${active ? 'var(--vscode-focusBorder)' : 'var(--vscode-input-border,#3c3c3c)'}`;
				entry.btn.style.background = active ? 'var(--vscode-list-activeSelectionBackground,rgba(0,120,212,0.12))' : 'transparent';
				entry.btn.style.color = active ? 'var(--vscode-focusBorder)' : 'var(--vscode-foreground)';
			}
		};
		refreshTypeBtns();

		// ---- Name (channel) / User Email (dm) ----
		const nameLbl = DOM.append(body, DOM.$('label'));
		nameLbl.textContent = isDm ? 'User email' : 'Name';
		nameLbl.style.cssText = labelStyle;

		const nameInput = DOM.append(body, DOM.$('input')) as HTMLInputElement;
		nameInput.type = 'text';
		nameInput.placeholder = isDm ? 'name@example.com' : '# e.g. lab-results';
		nameInput.style.cssText = inputStyle;
		nameInput.addEventListener('focus', () => { nameInput.style.borderColor = 'var(--vscode-focusBorder)'; });
		nameInput.addEventListener('blur', () => { nameInput.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });
		if (!isDm) {
			// Channel names: lowercase letters, numbers and hyphens only.
			nameInput.addEventListener('input', () => {
				const cleaned = nameInput.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+/, '');
				if (cleaned !== nameInput.value) { nameInput.value = cleaned; }
			});
			const hint = DOM.append(body, DOM.$('div'));
			hint.textContent = 'Lowercase letters, numbers, and hyphens only';
			hint.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:6px;';
		}

		// ---- Topic (channel only) ----
		let topicInput: HTMLInputElement | undefined;
		if (!isDm) {
			const topicLbl = DOM.append(body, DOM.$('label'));
			topicLbl.style.cssText = labelStyle + 'margin-top:18px;';
			topicLbl.textContent = 'Topic ';
			const optional = DOM.append(topicLbl, DOM.$('span'));
			optional.textContent = '(optional)';
			optional.style.cssText = 'font-weight:400;color:var(--vscode-descriptionForeground);';

			topicInput = DOM.append(body, DOM.$('input')) as HTMLInputElement;
			topicInput.type = 'text';
			topicInput.placeholder = 'What is this channel about?';
			topicInput.style.cssText = inputStyle;
			topicInput.addEventListener('focus', () => { topicInput!.style.borderColor = 'var(--vscode-focusBorder)'; });
			topicInput.addEventListener('blur', () => { topicInput!.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });
		}

		// ---- Members (private channels only) ----
		const selectedMembers = new Map<string, string>();
		let membersWrap: HTMLElement | undefined;
		if (!isDm) {
			membersWrap = DOM.append(body, DOM.$('div'));
			membersWrap.style.cssText = 'margin-top:18px;';
			const memberLbl = DOM.append(membersWrap, DOM.$('label'));
			memberLbl.textContent = 'Members';
			memberLbl.style.cssText = labelStyle;

			const chips = DOM.append(membersWrap, DOM.$('div'));
			chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;';

			const renderChips = () => {
				DOM.clearNode(chips);
				chips.style.display = selectedMembers.size ? 'flex' : 'none';
				for (const [id, name] of selectedMembers) {
					const chip = DOM.append(chips, DOM.$('span'));
					chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:12px;font-size:12px;';
					const txt = DOM.append(chip, DOM.$('span'));
					txt.textContent = name;
					const x = DOM.append(chip, DOM.$('span'));
					// allow-any-unicode-next-line
					x.textContent = '✕';
					x.style.cssText = 'cursor:pointer;opacity:0.8;';
					x.addEventListener('click', () => { selectedMembers.delete(id); renderChips(); });
				}
			};

			const memberInput = DOM.append(membersWrap, DOM.$('input')) as HTMLInputElement;
			memberInput.type = 'text';
			memberInput.placeholder = 'Search people...';
			memberInput.style.cssText = inputStyle;
			memberInput.addEventListener('focus', () => { memberInput.style.borderColor = 'var(--vscode-focusBorder)'; });
			memberInput.addEventListener('blur', () => { memberInput.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });

			const results = DOM.append(membersWrap, DOM.$('div'));
			results.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;margin-top:4px;max-height:160px;overflow:auto;display:none;';

			let searchTimer: number | undefined;
			let searchSeq = 0;
			// Search both staff users and patients so either can be added as a
			// channel member.
			const searchStaff = async (q: string): Promise<MemberCandidate[]> => {
				try {
					const res = await this.apiService.fetch(`/api/admin/users?size=10&search=${encodeURIComponent(q)}`);
					if (!res.ok) { return []; }
					const data = await res.json();
					const users = (data?.data || data?.content || data || []) as Array<{ id: string; firstName?: string; lastName?: string; email?: string }>;
					return users.filter(u => u.id).map(u => ({
						id: u.id,
						name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.id,
						detail: u.email || '',
						tag: 'Staff' as const,
					}));
				} catch { return []; }
			};
			const searchPatients = async (q: string): Promise<MemberCandidate[]> => {
				try {
					const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
					if (!res.ok) { return []; }
					const data = await res.json();
					const patients = (data?.data?.content || data?.content || data?.data || []) as Array<{ id?: string; fhirId?: string; firstName?: string; lastName?: string; dateOfBirth?: string }>;
					return patients.map(p => {
						const id = p.fhirId || p.id || '';
						return {
							id,
							name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || id,
							detail: p.dateOfBirth || '',
							tag: 'Patient' as const,
						};
					}).filter(c => c.id);
				} catch { return []; }
			};
			const runSearch = async (q: string) => {
				const seq = ++searchSeq;
				const [staff, patients] = await Promise.all([searchStaff(q), searchPatients(q)]);
				if (seq !== searchSeq) { return; } // a newer search superseded this one
				const matches = [...staff, ...patients].filter(c => !selectedMembers.has(c.id));
				DOM.clearNode(results);
				if (matches.length === 0) { results.style.display = 'none'; return; }
				results.style.display = 'block';
				for (const c of matches) {
					const row = DOM.append(results, DOM.$('div'));
					row.style.cssText = 'padding:8px 11px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:8px;';
					const label = DOM.append(row, DOM.$('span'));
					label.textContent = c.detail ? `${c.name} — ${c.detail}` : c.name;
					label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					const tag = DOM.append(row, DOM.$('span'));
					tag.textContent = c.tag;
					tag.style.cssText = `flex-shrink:0;font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;background:${c.tag === 'Patient' ? 'rgba(52,168,83,0.18)' : 'var(--vscode-badge-background)'};color:${c.tag === 'Patient' ? '#34a853' : 'var(--vscode-badge-foreground)'};`;
					row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
					row.addEventListener('mouseleave', () => { row.style.background = ''; });
					row.addEventListener('click', () => {
						selectedMembers.set(c.id, c.name);
						memberInput.value = '';
						results.style.display = 'none';
						renderChips();
					});
				}
			};
			memberInput.addEventListener('input', () => {
				const q = memberInput.value.trim();
				if (searchTimer) { targetWindow.clearTimeout(searchTimer); }
				if (q.length < 2) { results.style.display = 'none'; return; }
				searchTimer = targetWindow.setTimeout(() => runSearch(q), 250);
			});

			renderChips();
		}

		// ---- Error + footer ----
		const errEl = DOM.append(body, DOM.$('div'));
		errEl.style.cssText = 'font-size:12px;color:#f48771;margin-top:12px;display:none;';

		const footer = DOM.append(card, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;padding:16px 22px;border-top:1px solid var(--vscode-editorWidget-border);';

		const cancelBtn = DOM.append(footer, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:8px 18px;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;background:transparent;color:var(--vscode-foreground);font-size:13px;cursor:pointer;';
		cancelBtn.addEventListener('click', close);

		const createBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		createBtn.textContent = isDm ? 'Start' : 'Create Channel';
		createBtn.style.cssText = 'padding:8px 18px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;';
		createBtn.addEventListener('mouseenter', () => { createBtn.style.opacity = '0.9'; });
		createBtn.addEventListener('mouseleave', () => { createBtn.style.opacity = '1'; });

		const submit = async () => {
			const value = nameInput.value.trim();
			if (!value) { errEl.textContent = 'This field is required'; errEl.style.display = 'block'; return; }
			errEl.style.display = 'none';
			createBtn.disabled = true;
			const original = createBtn.textContent;
			createBtn.textContent = '...';
			try {
				if (!isDm) {
					const payload: Record<string, unknown> = { name: value, type: selectedType };
					const topic = topicInput?.value.trim();
					if (topic) { payload.topic = topic; }
					if (selectedType === 'private' && selectedMembers.size) {
						payload.memberIds = Array.from(selectedMembers.keys());
						payload.memberNames = Object.fromEntries(selectedMembers);
					}
					const res = await this.apiService.fetch('/api/channels', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(payload),
					});
					if (res.ok) {
						// Parse the saved channel from the response so the new row shows
						// instantly, without waiting on a second full-list GET.
						const saved = await parseSavedRecord(res);
						const chId = saved?.id ? String(saved.id) : '';
						const chName = saved?.name ? String(saved.name) : value;
						const chType = (saved?.type ? String(saved.type) : selectedType) as Channel['type'];
						close();
						// Optimistic instant reflect: prepend the freshly-created channel to
						// the in-memory list and re-render now; the background reload below
						// reconciles canonical server state (member list, ordering).
						if (chId && !this.channels.some(c => c.id === chId)) {
							this.channels = [{ id: chId, name: chName, type: chType }, ...this.channels];
							this._renderFilterTabs();
							this._renderList();
						}
						void this._loadChannels();
						const inp = new MessagingEditorInput(chId, chName, chType || selectedType);
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
						close();
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
				createBtn.textContent = original;
			}
		};
		createBtn.addEventListener('click', submit);
		nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { void submit(); } });

		setTimeout(() => nameInput.focus(), 50);
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}
}
