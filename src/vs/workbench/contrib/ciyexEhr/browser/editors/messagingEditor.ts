/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { MessagingEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface Message {
	id: string;
	channelId: string;
	senderId: string;
	senderName: string;
	content: string;
	parentId?: string;
	pinned: boolean;
	edited: boolean;
	deleted: boolean;
	system: boolean;
	systemType?: string;
	replyCount?: number;
	reactions?: Array<{ emoji: string; count: number; users: string[]; includesMe?: boolean }>;
	attachments?: Array<{ id: string; fileName: string; fileType: string; fileSize: number; fileUrl: string }>;
	mentions?: string[];
	createdAt: string;
	updatedAt?: string;
}

interface ChannelInfo {
	id: string;
	name: string;
	type: string;
	topic?: string;
	memberCount?: number;
}

// allow-any-unicode-next-line
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🙏'];

export class MessagingEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexMessaging';

	private root!: HTMLElement;
	private headerEl!: HTMLElement;
	private messageListEl!: HTMLElement;
	private composeEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private messages: Message[] = [];
	private channelInfo: ChannelInfo | null = null;
	private currentUserId = '';
	private pollTimer: Timeout | null = null;
	private loading = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(MessagingEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.messaging-editor'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:13px;background:var(--vscode-editor-background);';

		// Header
		this.headerEl = DOM.append(this.root, DOM.$('.messaging-header'));
		this.headerEl.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;gap:8px;flex-shrink:0;';

		// Message list
		this.messageListEl = DOM.append(this.root, DOM.$('.messaging-list'));
		this.messageListEl.style.cssText = 'flex:1;overflow-y:auto;padding:8px 0;';

		// Compose bar
		this.composeEl = DOM.append(this.root, DOM.$('.messaging-compose'));
		this.composeEl.style.cssText = 'padding:8px 16px;border-top:1px solid var(--vscode-editorWidget-border);display:flex;gap:8px;align-items:flex-end;flex-shrink:0;';

		this._buildCompose();
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof MessagingEditorInput)) { return; }

		// Get current user
		try {
			this.currentUserId = localStorage.getItem('ciyex_user_id') || '';
		} catch { /* */ }

		this.channelInfo = { id: input.channelId, name: input.channelName, type: input.channelType };
		this._renderHeader(input);
		await this._loadMessages(input.channelId, input.threadParentId);

		// Mark channel as read
		this.apiService.fetch(`/api/channels/${input.channelId}/read`, { method: 'POST' }).catch(() => { });

		// Start polling
		this._stopPolling();
		// eslint-disable-next-line no-restricted-globals
		this.pollTimer = setInterval(() => {
			if (!this.loading) {
				this._loadMessages(input.channelId, input.threadParentId);
			}
		}, 5000);
	}

	private _renderHeader(input: MessagingEditorInput): void {
		DOM.clearNode(this.headerEl);

		// Channel icon
		const icon = DOM.append(this.headerEl, DOM.$('span'));
		// allow-any-unicode-next-line
		icon.textContent = input.channelType === 'dm' ? '👤' : input.threadParentId ? '🧵' : '#';
		icon.style.cssText = 'font-size:18px;font-weight:700;color:var(--vscode-foreground);';

		// Channel name
		const name = DOM.append(this.headerEl, DOM.$('span'));
		name.textContent = input.threadParentId ? 'Thread' : input.channelName;
		name.style.cssText = 'font-weight:600;font-size:14px;';

		// Topic
		if (this.channelInfo?.topic) {
			const topic = DOM.append(this.headerEl, DOM.$('span'));
			topic.textContent = this.channelInfo.topic;
			topic.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;margin-left:8px;';
		}

		// Spacer
		DOM.append(this.headerEl, DOM.$('span')).style.flex = '1';

		// Search button
		const searchBtn = DOM.append(this.headerEl, DOM.$('button'));
		// allow-any-unicode-next-line
		searchBtn.textContent = '🔍';
		searchBtn.title = 'Search messages';
		searchBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:4px;';

		// Pin button
		const pinBtn = DOM.append(this.headerEl, DOM.$('button'));
		// allow-any-unicode-next-line
		pinBtn.textContent = '📌';
		pinBtn.title = 'Pinned messages';
		pinBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:4px;';
	}

	private async _loadMessages(channelId: string, threadParentId?: string): Promise<void> {
		this.loading = true;
		try {
			const url = threadParentId
				? `/api/messages/${threadParentId}/thread?limit=100`
				: `/api/channels/${channelId}/messages?limit=50`;
			const res = await this.apiService.fetch(url);
			if (!res.ok) { return; }
			const data = await res.json();

			let newMessages: Message[];
			if (threadParentId) {
				// Thread: parent + replies
				const threadData = data?.data || data;
				const parent = threadData?.parent || threadData;
				const replies: Message[] = threadData?.replies || threadData?.content || [];
				newMessages = Array.isArray(parent) ? parent : [parent, ...replies];
			} else {
				newMessages = data?.data || data?.content || data || [];
				if (!Array.isArray(newMessages)) { newMessages = []; }
			}

			// Only re-render if messages changed
			if (JSON.stringify(newMessages.map((m: Message) => m.id)) !== JSON.stringify(this.messages.map(m => m.id))
				|| newMessages.length !== this.messages.length) {
				this.messages = newMessages;
				this._renderMessages();
			}
		} catch { /* API not ready */ }
		this.loading = false;
	}

	private _renderMessages(): void {
		DOM.clearNode(this.messageListEl);

		if (this.messages.length === 0) {
			const empty = DOM.append(this.messageListEl, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = this.channelInfo?.type === 'dm'
				? 'Start a conversation...'
				: 'No messages yet. Say something!';
			return;
		}

		let lastDate = '';
		for (const msg of this.messages) {
			// Date separator
			const msgDate = new Date(msg.createdAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
			if (msgDate !== lastDate) {
				lastDate = msgDate;
				const sep = DOM.append(this.messageListEl, DOM.$('div'));
				sep.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;';
				const line1 = DOM.append(sep, DOM.$('div'));
				line1.style.cssText = 'flex:1;height:1px;background:var(--vscode-editorWidget-border);';
				const label = DOM.append(sep, DOM.$('span'));
				const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
				label.textContent = msgDate === today ? 'Today' : msgDate;
				label.style.cssText = 'font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);white-space:nowrap;';
				const line2 = DOM.append(sep, DOM.$('div'));
				line2.style.cssText = 'flex:1;height:1px;background:var(--vscode-editorWidget-border);';
			}

			if (msg.deleted) {
				const del = DOM.append(this.messageListEl, DOM.$('div'));
				del.style.cssText = 'padding:4px 16px;color:var(--vscode-descriptionForeground);font-style:italic;font-size:12px;';
				del.textContent = '[This message was deleted]';
				continue;
			}

			if (msg.system) {
				const sys = DOM.append(this.messageListEl, DOM.$('div'));
				sys.style.cssText = 'padding:4px 16px;color:var(--vscode-descriptionForeground);font-style:italic;font-size:12px;text-align:center;';
				sys.textContent = msg.content;
				continue;
			}

			this._renderMessage(msg);
		}

		// Scroll to bottom
		this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
	}

	private _renderMessage(msg: Message): void {
		const row = DOM.append(this.messageListEl, DOM.$('div'));
		row.style.cssText = 'padding:6px 16px;display:flex;gap:10px;position:relative;';
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; hoverActions.style.display = 'flex'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; hoverActions.style.display = 'none'; });

		// Avatar
		const initials = msg.senderName.split(' ').map(w => (w[0] || '')).join('').substring(0, 2).toUpperCase() || '?';
		const hue = Math.abs(msg.senderName.split('').reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0)) % 360;
		const av = DOM.append(row, DOM.$('div'));
		av.textContent = initials;
		av.style.cssText = `width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#fff;flex-shrink:0;background:hsl(${hue},45%,45%);margin-top:2px;`;

		// Content column
		const col = DOM.append(row, DOM.$('div'));
		col.style.cssText = 'flex:1;min-width:0;';

		// Name + time
		const header = DOM.append(col, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:baseline;gap:6px;';
		const nameEl = DOM.append(header, DOM.$('span'));
		nameEl.textContent = msg.senderName;
		nameEl.style.cssText = 'font-weight:600;font-size:13px;';
		const timeEl = DOM.append(header, DOM.$('span'));
		timeEl.textContent = new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
		timeEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		if (msg.edited) {
			const edited = DOM.append(header, DOM.$('span'));
			edited.textContent = '(edited)';
			edited.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
		}

		// Content
		const content = DOM.append(col, DOM.$('div'));
		content.style.cssText = 'margin-top:2px;line-height:1.5;word-break:break-word;white-space:pre-wrap;';
		this._renderRichContent(content, msg.content);

		// Attachments
		if (msg.attachments && msg.attachments.length > 0) {
			const attRow = DOM.append(col, DOM.$('div'));
			attRow.style.cssText = 'margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;';
			for (const att of msg.attachments) {
				const card = DOM.append(attRow, DOM.$('div'));
				card.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;cursor:pointer;max-width:250px;';
				card.addEventListener('mouseenter', () => { card.style.background = 'var(--vscode-list-hoverBackground)'; });
				card.addEventListener('mouseleave', () => { card.style.background = ''; });
				const icon = DOM.append(card, DOM.$('span'));
				// allow-any-unicode-next-line
				icon.textContent = att.fileType?.startsWith('image') ? '🖼️' : '📎';
				const info = DOM.append(card, DOM.$('div'));
				const fname = DOM.append(info, DOM.$('div'));
				fname.textContent = att.fileName;
				fname.style.cssText = 'font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;';
				const fsize = DOM.append(info, DOM.$('div'));
				fsize.textContent = this._formatSize(att.fileSize);
				fsize.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';
			}
		}

		// Reactions
		if (msg.reactions && msg.reactions.length > 0) {
			const reactRow = DOM.append(col, DOM.$('div'));
			reactRow.style.cssText = 'margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;';
			for (const r of msg.reactions) {
				const badge = DOM.append(reactRow, DOM.$('button'));
				badge.textContent = `${r.emoji} ${r.count}`;
				badge.style.cssText = `font-size:11px;padding:2px 6px;border-radius:10px;cursor:pointer;border:1px solid var(--vscode-editorWidget-border);background:${r.includesMe ? 'rgba(0,122,204,0.15)' : 'transparent'};`;
				badge.addEventListener('click', () => this._toggleReaction(msg.id, r.emoji));
			}
		}

		// Thread preview
		if (msg.replyCount && msg.replyCount > 0 && !this._getInput()?.threadParentId) {
			const thread = DOM.append(col, DOM.$('div'));
			thread.style.cssText = 'margin-top:4px;font-size:12px;color:var(--vscode-textLink-foreground);cursor:pointer;';
			// allow-any-unicode-next-line
			thread.textContent = `💬 ${msg.replyCount} ${msg.replyCount === 1 ? 'reply' : 'replies'}`;
			thread.addEventListener('click', () => {
				const input = this._getInput();
				if (input) {
					this.commandService.executeCommand('ciyex.messaging.openThread', input.channelId, msg.id, input.channelName);
				}
			});
		}

		// Hover actions
		const hoverActions = DOM.append(row, DOM.$('div'));
		hoverActions.style.cssText = 'display:none;position:absolute;right:16px;top:-8px;background:var(--vscode-editor-background);border:1px solid var(--vscode-editorWidget-border);border-radius:6px;padding:2px;gap:2px;';

		for (const emoji of QUICK_REACTIONS.slice(0, 3)) {
			const btn = DOM.append(hoverActions, DOM.$('button'));
			btn.textContent = emoji;
			btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--vscode-list-hoverBackground)'; });
			btn.addEventListener('mouseleave', () => { btn.style.background = ''; });
			btn.addEventListener('click', () => this._toggleReaction(msg.id, emoji));
		}

		// Reply button
		if (!this._getInput()?.threadParentId) {
			const replyBtn = DOM.append(hoverActions, DOM.$('button'));
			// allow-any-unicode-next-line
			replyBtn.textContent = '💬';
			replyBtn.title = 'Reply in thread';
			replyBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			replyBtn.addEventListener('mouseenter', () => { replyBtn.style.background = 'var(--vscode-list-hoverBackground)'; });
			replyBtn.addEventListener('mouseleave', () => { replyBtn.style.background = ''; });
			replyBtn.addEventListener('click', () => {
				const inp = this._getInput();
				if (inp) {
					this.commandService.executeCommand('ciyex.messaging.openThread', inp.channelId, msg.id, inp.channelName);
				}
			});
		}

		// Pin button
		const pinBtn = DOM.append(hoverActions, DOM.$('button'));
		// allow-any-unicode-next-line
		pinBtn.textContent = '📌';
		pinBtn.title = msg.pinned ? 'Unpin' : 'Pin';
		pinBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
		pinBtn.addEventListener('mouseenter', () => { pinBtn.style.background = 'var(--vscode-list-hoverBackground)'; });
		pinBtn.addEventListener('mouseleave', () => { pinBtn.style.background = ''; });
		pinBtn.addEventListener('click', () => this._togglePin(msg.id, msg.pinned));

		// Edit button (only for own messages)
		if (msg.senderId === this.currentUserId) {
			const editBtn = DOM.append(hoverActions, DOM.$('button'));
			// allow-any-unicode-next-line
			editBtn.textContent = '✏️';
			editBtn.title = 'Edit';
			editBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			editBtn.addEventListener('mouseenter', () => { editBtn.style.background = 'var(--vscode-list-hoverBackground)'; });
			editBtn.addEventListener('mouseleave', () => { editBtn.style.background = ''; });
			editBtn.addEventListener('click', () => this._editMessage(msg.id, msg.content));

			const delBtn = DOM.append(hoverActions, DOM.$('button'));
			// allow-any-unicode-next-line
			delBtn.textContent = '🗑️';
			delBtn.title = 'Delete';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			delBtn.addEventListener('mouseenter', () => { delBtn.style.background = 'var(--vscode-list-hoverBackground)'; });
			delBtn.addEventListener('mouseleave', () => { delBtn.style.background = ''; });
			delBtn.addEventListener('click', () => this._deleteMessage(msg.id));
		}
	}

	private _buildCompose(): void {
		// Attach button
		const attachBtn = DOM.append(this.composeEl, DOM.$('button'));
		// allow-any-unicode-next-line
		attachBtn.textContent = '📎';
		attachBtn.title = 'Attach file';
		attachBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;padding:4px;flex-shrink:0;';
		attachBtn.addEventListener('click', () => this._attachFile());

		// Input
		this.inputEl = DOM.append(this.composeEl, DOM.$('textarea')) as HTMLTextAreaElement;
		this.inputEl.placeholder = 'Type a message...';
		this.inputEl.style.cssText = 'flex:1;padding:8px 12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;font-family:inherit;resize:none;min-height:36px;max-height:120px;line-height:1.4;';
		this.inputEl.rows = 1;
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
			// Up arrow in empty input → edit last own message
			if (e.key === 'ArrowUp' && !this.inputEl.value.trim()) {
				e.preventDefault();
				this._editLastMessage();
			}
		});
		this.inputEl.addEventListener('input', () => {
			// Auto-resize
			this.inputEl.style.height = 'auto';
			this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';
		});

		// Send button
		const sendBtn = DOM.append(this.composeEl, DOM.$('button'));
		// allow-any-unicode-next-line
		sendBtn.textContent = '▶';
		sendBtn.title = 'Send';
		sendBtn.style.cssText = 'padding:6px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:6px;cursor:pointer;font-size:14px;flex-shrink:0;';
		sendBtn.addEventListener('click', () => this._sendMessage());
	}

	private async _sendMessage(): Promise<void> {
		const input = this._getInput();
		if (!input || !this.inputEl.value.trim()) { return; }

		const content = this.inputEl.value.trim();
		this.inputEl.value = '';
		this.inputEl.style.height = 'auto';

		try {
			const body: Record<string, string> = { content };
			if (input.threadParentId) {
				body.parentId = input.threadParentId;
			}

			await this.apiService.fetch(`/api/channels/${input.channelId}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			// Refresh immediately
			await this._loadMessages(input.channelId, input.threadParentId);
		} catch { /* failed to send */ }
	}

	private async _toggleReaction(messageId: string, emoji: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/messages/${messageId}/reactions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emoji }),
			});
			const input = this._getInput();
			if (input) { await this._loadMessages(input.channelId, input.threadParentId); }
		} catch { /* */ }
	}

	private async _togglePin(messageId: string, currentlyPinned: boolean): Promise<void> {
		try {
			await this.apiService.fetch(`/api/messages/${messageId}/pin`, {
				method: currentlyPinned ? 'DELETE' : 'POST',
			});
			const input = this._getInput();
			if (input) { await this._loadMessages(input.channelId, input.threadParentId); }
		} catch { /* */ }
	}

	private _getInput(): MessagingEditorInput | undefined {
		return this.input instanceof MessagingEditorInput ? this.input : undefined;
	}

	private _attachFile(): void {
		// Create hidden file input
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.multiple = true;
		fileInput.addEventListener('change', async () => {
			const files = fileInput.files;
			if (!files || files.length === 0) { return; }
			const input = this._getInput();
			if (!input) { return; }

			// Send a message first, then attach files
			const content = this.inputEl.value.trim() || `Attached ${files.length} file(s)`;
			this.inputEl.value = '';

			try {
				const msgRes = await this.apiService.fetch(`/api/channels/${input.channelId}/messages`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content }),
				});
				if (!msgRes.ok) { return; }
				const msgData = await msgRes.json();
				const messageId = msgData?.data?.id || msgData?.id;

				// Upload each file as attachment
				for (let i = 0; i < files.length; i++) {
					const formData = new FormData();
					formData.append('file', files[i]);
					await this.apiService.fetch(`/api/messages/${messageId}/attachments`, {
						method: 'POST',
						body: formData,
						headers: {}, // Let browser set Content-Type with boundary
					});
				}

				await this._loadMessages(input.channelId, input.threadParentId);
			} catch { /* upload failed */ }
		});
		fileInput.click();
	}

	private _editLastMessage(): void {
		// Find last message from current user
		const myMessages = this.messages.filter(m => m.senderId === this.currentUserId && !m.deleted && !m.system);
		const last = myMessages[myMessages.length - 1];
		if (last) {
			this._editMessage(last.id, last.content);
		}
	}

	private async _editMessage(messageId: string, currentContent: string): Promise<void> {
		// Put current content in input for editing
		this.inputEl.value = currentContent;
		this.inputEl.focus();
		this.inputEl.style.height = 'auto';
		this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 120) + 'px';

		// Replace the send handler temporarily
		const originalSend = this._sendMessage.bind(this);
		this._sendMessage = async () => {
			const newContent = this.inputEl.value.trim();
			if (!newContent) { return; }
			this.inputEl.value = '';
			this.inputEl.style.height = 'auto';

			try {
				await this.apiService.fetch(`/api/messages/${messageId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: newContent }),
				});
				const input = this._getInput();
				if (input) { await this._loadMessages(input.channelId, input.threadParentId); }
			} catch { /* edit failed */ }

			// Restore original send
			this._sendMessage = originalSend;
		};
	}

	private async _deleteMessage(messageId: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/messages/${messageId}`, { method: 'DELETE' });
			const input = this._getInput();
			if (input) { await this._loadMessages(input.channelId, input.threadParentId); }
		} catch { /* delete failed */ }
	}

	// Parse @mentions and *bold* / _italic_ / `code` into DOM nodes without innerHTML
	// (VS Code's Trusted Types policy throws on direct innerHTML string assignment).
	private _renderRichContent(container: HTMLElement, text: string): void {
		const pattern = /@(\w+)|\*\*(.+?)\*\*|_(.+?)_|`(.+?)`/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			if (match.index > lastIndex) {
				container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
			}
			const [full, mention, bold, italic, code] = match;
			if (mention !== undefined) {
				const span = DOM.append(container, DOM.$('span'));
				span.textContent = `@${mention}`;
				span.style.cssText = 'background:rgba(0,122,204,0.15);color:var(--vscode-textLink-foreground);padding:0 2px;border-radius:3px;';
			} else if (bold !== undefined) {
				const el = DOM.append(container, DOM.$('strong'));
				el.textContent = bold;
			} else if (italic !== undefined) {
				const el = DOM.append(container, DOM.$('em'));
				el.textContent = italic;
			} else if (code !== undefined) {
				const el = DOM.append(container, DOM.$('code'));
				el.textContent = code;
				el.style.cssText = 'background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-size:12px;';
			}
			lastIndex = match.index + full.length;
		}
		if (lastIndex < text.length) {
			container.appendChild(document.createTextNode(text.substring(lastIndex)));
		}
	}

	private _formatSize(bytes: number): string {
		if (bytes < 1024) { return `${bytes} B`; }
		if (bytes < 1048576) { return `${(bytes / 1024).toFixed(1)} KB`; }
		return `${(bytes / 1048576).toFixed(1)} MB`;
	}

	private _stopPolling(): void {
		if (this.pollTimer) {
			// eslint-disable-next-line no-restricted-globals
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}

	override dispose(): void {
		this._stopPolling();
		super.dispose();
	}
}
