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
import { mainWindow } from '../../../../../base/browser/window.js';

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
	// Compose input is a `contentEditable` div so the format buttons (B/I/U/lists)
	// can drive `document.execCommand` for true WYSIWYG rich-text — matches the
	// EHR-UI ComposeBar (textareas show only markdown markers, not actual formatting).
	private inputEl!: HTMLDivElement;
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
		this.root = DOM.append(parent, DOM.$('.messaging-editor.ciyex-editor-root'));
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
				const isImage = att.fileType?.startsWith('image') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(att.fileName);
				const card = DOM.append(attRow, DOM.$('div'));
				card.style.cssText = 'display:flex;flex-direction:column;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;cursor:pointer;overflow:hidden;max-width:260px;';
				card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--vscode-focusBorder)'; });
				card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--vscode-editorWidget-border)'; });

				if (isImage && att.fileUrl) {
					// Inline thumbnail preview for images
					const img = DOM.append(card, DOM.$('img')) as HTMLImageElement;
					img.src = att.fileUrl;
					img.alt = att.fileName;
					img.style.cssText = 'width:100%;max-height:160px;object-fit:cover;display:block;';
					img.addEventListener('error', () => { img.style.display = 'none'; });
					// Click → open full-size in a lightbox overlay
					card.addEventListener('click', () => this._showImagePreview(att.fileUrl, att.fileName));
				}

				const meta = DOM.append(card, DOM.$('div'));
				meta.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;';
				const icon = DOM.append(meta, DOM.$('span'));
				// allow-any-unicode-next-line
				icon.textContent = isImage ? '\u{1F5BC}️' : '\u{1F4CE}';
				const info = DOM.append(meta, DOM.$('div'));
				const fname = DOM.append(info, DOM.$('div'));
				fname.textContent = att.fileName;
				fname.style.cssText = 'font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px;';
				const fsize = DOM.append(info, DOM.$('div'));
				fsize.textContent = this._formatSize(att.fileSize);
				fsize.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

				if (!isImage && att.fileUrl) {
					card.addEventListener('click', () => {
						// Open non-image files in a new tab / external
						const a = document.createElement('a');
						a.href = att.fileUrl;
						a.target = '_blank';
						a.rel = 'noopener noreferrer';
						a.click();
					});
				}
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
		// Switch compose layout to a column so the toolbar sits above the input.
		this.composeEl.style.cssText = 'padding:8px 16px;border-top:1px solid var(--vscode-editorWidget-border);display:flex;flex-direction:column;gap:6px;flex-shrink:0;';

		// Formatting toolbar (Bold / Italic / Underline / Code / Link / Bullet / Emoji)
		const toolbar = DOM.append(this.composeEl, DOM.$('.messaging-toolbar'));
		toolbar.style.cssText = 'display:flex;gap:2px;align-items:center;flex-wrap:wrap;';

		const mkFmtBtn = (label: string, title: string, extraStyle: string, onClick: () => void) => {
			const b = DOM.append(toolbar, DOM.$('button')) as HTMLButtonElement;
			b.textContent = label;
			b.title = title;
			b.style.cssText = 'background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;font-size:13px;padding:4px 8px;color:var(--vscode-foreground);min-width:28px;' + extraStyle;
			b.addEventListener('mouseenter', () => { b.style.background = 'var(--vscode-toolbar-hoverBackground,rgba(255,255,255,0.08))'; });
			b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
			b.addEventListener('mousedown', (e) => { e.preventDefault(); });
			b.addEventListener('click', () => { onClick(); if (this.inputEl) { this.inputEl.focus(); } });
			return b;
		};
		mkFmtBtn('B', 'Bold (Ctrl+B)', 'font-weight:700;', () => this._execFormat('bold'));
		mkFmtBtn('I', 'Italic (Ctrl+I)', 'font-style:italic;', () => this._execFormat('italic'));
		mkFmtBtn('U', 'Underline (Ctrl+U)', 'text-decoration:underline;', () => this._execFormat('underline'));
		mkFmtBtn('S', 'Strikethrough', 'text-decoration:line-through;', () => this._execFormat('strikeThrough'));

		// Separator
		const sep1 = DOM.append(toolbar, DOM.$('span'));
		sep1.style.cssText = 'width:1px;height:18px;background:var(--vscode-editorWidget-border);margin:0 4px;';

		// allow-any-unicode-next-line
		mkFmtBtn('🔗', 'Insert link', '', () => this._insertLink());
		mkFmtBtn('1.', 'Numbered list', 'font-family:monospace;', () => this._execFormat('insertOrderedList'));
		// allow-any-unicode-next-line
		mkFmtBtn('☰', 'Bullet list', '', () => this._execFormat('insertUnorderedList'));

		// Separator
		const sep2 = DOM.append(toolbar, DOM.$('span'));
		sep2.style.cssText = 'width:1px;height:18px;background:var(--vscode-editorWidget-border);margin:0 4px;';

		mkFmtBtn('"', 'Quote', '', () => this._execFormat('formatBlock', 'blockquote'));
		// allow-any-unicode-next-line
		mkFmtBtn('<>', 'Inline code', 'font-family:monospace;', () => this._wrapInlineCode());
		mkFmtBtn('{}', 'Code block', 'font-family:monospace;', () => this._execFormat('formatBlock', 'pre'));

		// Spacer pushes attach to the right (kept inline with toolbar for compactness)
		const spacer = DOM.append(toolbar, DOM.$('span'));
		spacer.style.flex = '1';

		// Input row: attach + textarea + send
		const inputRow = DOM.append(this.composeEl, DOM.$('.messaging-input-row'));
		inputRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;';

		// Attach button — opens a small Image / File / Camera menu instead of
		// jumping straight to the OS file picker (Issue #7 — matches the
		// EHR-UI's three-option attachment popover).
		const attachWrap = DOM.append(inputRow, DOM.$('div'));
		attachWrap.style.cssText = 'position:relative;flex-shrink:0;';
		const attachBtn = DOM.append(attachWrap, DOM.$('button'));
		// allow-any-unicode-next-line
		attachBtn.textContent = '📎';
		attachBtn.title = 'Attach';
		attachBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;padding:4px;';
		const attachMenu = DOM.append(attachWrap, DOM.$('div'));
		attachMenu.style.cssText = 'position:absolute;bottom:100%;left:0;margin-bottom:6px;background:var(--vscode-dropdown-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-dropdown-border,var(--vscode-editorWidget-border));border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.25);min-width:140px;display:none;z-index:1500;padding:4px 0;';
		const mkAttachOpt = (icon: string, label: string, onClick: () => void) => {
			const opt = DOM.append(attachMenu, DOM.$('div'));
			opt.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:var(--vscode-foreground);';
			const ic = DOM.append(opt, DOM.$('span'));
			ic.textContent = icon;
			ic.style.cssText = 'font-size:14px;width:18px;text-align:center;';
			const tx = DOM.append(opt, DOM.$('span'));
			tx.textContent = label;
			opt.addEventListener('mouseenter', () => { opt.style.background = 'var(--vscode-list-hoverBackground)'; });
			opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
			opt.addEventListener('click', () => {
				attachMenu.style.display = 'none';
				onClick();
			});
		};
		// allow-any-unicode-next-line
		mkAttachOpt('🖼', 'Image', () => this._attachFile('image/*'));
		// allow-any-unicode-next-line
		mkAttachOpt('📄', 'File', () => this._attachFile('*/*'));
		// allow-any-unicode-next-line
		mkAttachOpt('📷', 'Camera', () => this._attachFile('image/*', true)); // capture=true
		attachBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			attachMenu.style.display = attachMenu.style.display === 'none' ? 'block' : 'none';
		});
		// Dismiss the menu on any outside click.
		DOM.getActiveWindow().document.addEventListener('click', (e) => {
			if (!attachWrap.contains(e.target as Node)) { attachMenu.style.display = 'none'; }
		});

		// Input — contentEditable div drives true WYSIWYG (B/I/U/lists render
		// inline instead of inserting markdown markers).
		this.inputEl = DOM.append(inputRow, DOM.$('div.messaging-input')) as HTMLDivElement;
		this.inputEl.contentEditable = 'true';
		this.inputEl.setAttribute('data-placeholder', 'Type a message...');
		this.inputEl.style.cssText = 'flex:1;padding:8px 12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;font-family:inherit;min-height:36px;max-height:120px;overflow-y:auto;line-height:1.4;outline:none;';
		// Placeholder via CSS — contentEditable doesn't honour the standard one.
		const phStyle = DOM.append(this.composeEl, DOM.$('style'));
		phStyle.textContent = '.messaging-input:empty:before{content:attr(data-placeholder);color:var(--vscode-input-placeholderForeground,var(--vscode-descriptionForeground));pointer-events:none;}'
			+ '.messaging-input blockquote{border-left:2px solid var(--vscode-editorWidget-border,#3c3c3c);padding-left:8px;color:var(--vscode-descriptionForeground);margin:4px 0;}'
			+ '.messaging-input ol{padding-left:20px;list-style:decimal;}'
			+ '.messaging-input ul{padding-left:20px;list-style:disc;}'
			+ '.messaging-input pre{background:var(--vscode-textCodeBlock-background);padding:6px 8px;border-radius:4px;font-family:monospace;font-size:12px;white-space:pre-wrap;}'
			+ '.messaging-input code{background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-family:monospace;font-size:12px;}';
		this.inputEl.addEventListener('keydown', (e) => {
			// Keyboard shortcuts for formatting
			if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
				if (e.key === 'b' || e.key === 'B') { e.preventDefault(); this._execFormat('bold'); return; }
				if (e.key === 'i' || e.key === 'I') { e.preventDefault(); this._execFormat('italic'); return; }
				if (e.key === 'u' || e.key === 'U') { e.preventDefault(); this._execFormat('underline'); return; }
			}
			if (e.key === 'Enter' && !e.shiftKey) {
				e.preventDefault();
				this._sendMessage();
			}
			// Up arrow in empty input → edit last own message
			if (e.key === 'ArrowUp' && !(this.inputEl.textContent || '').trim()) {
				e.preventDefault();
				this._editLastMessage();
			}
		});

		// Send button
		const sendBtn = DOM.append(inputRow, DOM.$('button'));
		// allow-any-unicode-next-line
		sendBtn.textContent = '▶';
		sendBtn.title = 'Send';
		sendBtn.style.cssText = 'padding:6px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:6px;cursor:pointer;font-size:14px;flex-shrink:0;';
		sendBtn.addEventListener('click', () => this._sendMessage());
	}

	/**
	 * Apply a rich-text formatting command (bold, italic, underline, lists, etc.)
	 * to the current selection within the contentEditable input — matches the
	 * EHR-UI ComposeBar which also uses document.execCommand for WYSIWYG editing.
	 */
	private _execFormat(command: string, value?: string): void {
		if (!this.inputEl) { return; }
		this.inputEl.focus();
		try { mainWindow.document.execCommand(command, false, value); } catch { /* ignore */ }
	}

	private _insertLink(): void {
		const url = mainWindow.prompt('Enter URL:');
		if (!url) { return; }
		this._execFormat('createLink', url);
	}

	private _wrapInlineCode(): void {
		if (!this.inputEl) { return; }
		this.inputEl.focus();
		const sel = mainWindow.getSelection();
		if (!sel || sel.rangeCount === 0) { return; }
		const range = sel.getRangeAt(0);
		const code = mainWindow.document.createElement('code');
		const selected = range.toString();
		if (selected) {
			code.textContent = selected;
			range.deleteContents();
			range.insertNode(code);
			sel.collapseToEnd();
		} else {
			// allow-any-unicode-next-line
			code.textContent = '​';
			range.insertNode(code);
			const tn = code.firstChild!;
			range.setStart(tn, 1);
			range.setEnd(tn, 1);
			sel.removeAllRanges();
			sel.addRange(range);
		}
	}

	private _getInputText(): string {
		// Read the contentEditable as plain text — innerText preserves line breaks
		// from <br>/<div> while stripping inline formatting tags. Receivers render
		// the message as plain text (or via the existing markdown-style parser),
		// so the wire format stays compatible with prior textarea-based history.
		return (this.inputEl.innerText || this.inputEl.textContent || '').trim();
	}

	private _clearInput(): void {
		// Empty both representations so the `:empty:before` placeholder shows again
		// (an empty <div></div> still satisfies `:empty`, but a stray <br> won't).
		this.inputEl.textContent = '';
	}

	private async _sendMessage(): Promise<void> {
		const input = this._getInput();
		const text = this._getInputText();
		if (!input || !text) { return; }

		const content = text;
		this._clearInput();

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

	private _attachFile(accept = '*/*', capture = false): void {
		// Create hidden file input
		const fileInput = document.createElement('input');
		fileInput.type = 'file';
		fileInput.accept = accept;
		if (capture) { fileInput.setAttribute('capture', 'environment'); }
		fileInput.multiple = !capture;
		fileInput.addEventListener('change', async () => {
			const files = fileInput.files;
			if (!files || files.length === 0) { return; }
			const input = this._getInput();
			if (!input) { return; }

			// Send a message first, then attach files
			const content = this._getInputText() || `Attached ${files.length} file(s)`;
			this._clearInput();

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
		this.inputEl.textContent = currentContent;
		this.inputEl.focus();

		// Replace the send handler temporarily
		const originalSend = this._sendMessage.bind(this);
		this._sendMessage = async () => {
			const newContent = this._getInputText();
			if (!newContent) { return; }
			this._clearInput();

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

	// Parse @mentions and **bold** / __underline__ / _italic_ / ~~strike~~ / `code` into DOM nodes
	// without innerHTML (VS Code's Trusted Types policy throws on direct innerHTML string assignment).
	// Order matters: longer markers (** , __, ~~) must be tested before single-char counterparts.
	private _renderRichContent(container: HTMLElement, text: string): void {
		const pattern = /@(\w+)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|_(.+?)_|`(.+?)`/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			if (match.index > lastIndex) {
				container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
			}
			const [full, mention, bold, underline, strike, italic, code] = match;
			if (mention !== undefined) {
				const span = DOM.append(container, DOM.$('span'));
				span.textContent = `@${mention}`;
				span.style.cssText = 'background:rgba(0,122,204,0.15);color:var(--vscode-textLink-foreground);padding:0 2px;border-radius:3px;';
			} else if (bold !== undefined) {
				const el = DOM.append(container, DOM.$('strong'));
				el.textContent = bold;
			} else if (underline !== undefined) {
				const el = DOM.append(container, DOM.$('u'));
				el.textContent = underline;
				el.style.textDecoration = 'underline';
			} else if (strike !== undefined) {
				const el = DOM.append(container, DOM.$('s'));
				el.textContent = strike;
				el.style.textDecoration = 'line-through';
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

	private _showImagePreview(url: string, name: string): void {
		// Full-screen lightbox overlay for image attachments
		const overlay = document.createElement('div');
		overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:zoom-out;';
		overlay.addEventListener('click', () => overlay.remove());

		const header = document.createElement('div');
		header.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.5);';
		const title = document.createElement('span');
		title.textContent = name;
		title.style.cssText = 'font-size:13px;color:#fff;font-weight:500;';
		const closeBtn = document.createElement('button');
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:2px 8px;';
		closeBtn.addEventListener('click', () => overlay.remove());
		header.appendChild(title);
		header.appendChild(closeBtn);
		overlay.appendChild(header);

		const img = document.createElement('img');
		img.src = url;
		img.alt = name;
		img.style.cssText = 'max-width:90vw;max-height:85vh;object-fit:contain;border-radius:4px;box-shadow:0 4px 24px rgba(0,0,0,0.5);';
		img.addEventListener('click', (e) => e.stopPropagation());
		overlay.appendChild(img);

		mainWindow.document.body.appendChild(overlay);
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
