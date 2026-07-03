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
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { parseSavedRecord } from '../sidebarActions.js';

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

interface ChannelMember {
	userId: string;
	displayName: string;
	role?: string;
	joinedAt?: string;
	avatar?: { initials?: string; color?: string };
}

/** A staff user or patient returned by the member-search, addable to a channel. */
interface MemberSearchResult {
	id: string;
	name: string;
	detail: string;
	tag: 'Staff' | 'Patient';
}

interface ChannelInfo {
	id: string;
	name: string;
	type: string;
	topic?: string;
	description?: string;
	createdAt?: string;
	createdBy?: string;
	memberCount?: number;
	members?: ChannelMember[];
}

/**
 * A selectable person (provider or patient) shown in the "New Message" people
 * picker. Mirrors the EHR-UI ChannelSidebar user-picker entry: id is used as the
 * DM `targetUserId`, name as `targetUserName`, and the subtitle/badge are derived
 * from the role (Provider specialty / Patient DOB).
 */
interface PersonEntry {
	id: string;
	name: string;
	type: 'provider' | 'patient';
	dob?: string;
	subtitle?: string;
}

// allow-any-unicode-next-line
const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀', '🙏'];

export class MessagingEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexMessaging';

	private root!: HTMLElement;
	private headerEl!: HTMLElement;
	// Horizontal row below the header holding the conversation column and the
	// (initially hidden) channel-details side panel.
	private bodyRowEl!: HTMLElement;
	private mainColEl!: HTMLElement;
	private messageListEl!: HTMLElement;
	private composeEl!: HTMLElement;
	// "Channel details" side panel (About / Members / Pinned / Files) — mirrors the
	// EHR-UI right-hand info panel. Toggled from the header info button.
	private detailsEl!: HTMLElement;
	private detailsOpen = false;
	private detailsTab: 'about' | 'members' | 'pinned' | 'files' = 'about';
	// Compose input is a `contentEditable` div so the format buttons (B/I/U/lists)
	// can drive `document.execCommand` for true WYSIWYG rich-text — matches the
	// EHR-UI ComposeBar (textareas show only markdown markers, not actual formatting).
	private inputEl!: HTMLDivElement;
	// @-mention autocomplete: a Slack/WhatsApp-style popup that lists the current
	// channel's members as the user types "@". `mentionDropdownEl` is the popup
	// element; `mentionState` is non-null only while the popup is open and tracks
	// the in-progress "@query", its position in the input's text node, the filtered
	// member matches and the highlighted row.
	private mentionDropdownEl: HTMLElement | undefined;
	// Org-wide people directory (staff + patients) merged into the @-mention
	// candidates — the channel roster alone can be a single owner row, but every
	// org user (provider, nurse, patient, …) should be mentionable. Loaded once
	// per editor from the same endpoints as the add-people picker.
	private orgDirectory: ChannelMember[] = [];
	private orgDirectoryLoaded = false;
	private mentionState: {
		node: Text;
		atIndex: number;
		caretIndex: number;
		query: string;
		matches: ChannelMember[];
		activeIndex: number;
	} | null = null;
	// Pending-attachment preview tray: files chosen via the attach menu / camera
	// are staged here (with thumbnails + a remove button) and only uploaded when
	// the user actually hits Send, so they can review or drop them beforehand.
	private attachmentsPreviewEl!: HTMLElement;
	private pendingAttachments: File[] = [];
	private pendingPreviewUrls: string[] = [];
	// Object URLs created for rendered (received) attachments — their bytes are
	// fetched through the authenticated proxy, so we hold the blob URLs here and
	// revoke them on the next render / dispose to avoid leaks.
	private attachmentObjectUrls: string[] = [];
	private messages: Message[] = [];
	private channelInfo: ChannelInfo | null = null;
	private currentUserId = '';
	private pollTimer: Timeout | null = null;
	private loading = false;
	// People-picker state (the "New Message" DM flow). `people` is fetched once on
	// first use; `peopleSearch` holds the live filter text so re-rendering keeps it.
	private people: PersonEntry[] = [];
	private peopleLoaded = false;
	private peopleSearch = '';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(MessagingEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.messaging-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;font-size:13px;background:var(--vscode-editor-background);';

		// Header
		this.headerEl = DOM.append(this.root, DOM.$('.messaging-header'));
		this.headerEl.style.cssText = 'padding:10px 16px;border-bottom:1px solid var(--vscode-editorWidget-border);display:flex;align-items:center;gap:8px;flex-shrink:0;';

		// Body row: conversation column + (hidden) channel-details side panel.
		this.bodyRowEl = DOM.append(this.root, DOM.$('.messaging-body'));
		this.bodyRowEl.style.cssText = 'flex:1;display:flex;min-height:0;overflow:hidden;';

		this.mainColEl = DOM.append(this.bodyRowEl, DOM.$('.messaging-main'));
		this.mainColEl.style.cssText = 'flex:1;display:flex;flex-direction:column;min-width:0;';

		// Message list
		this.messageListEl = DOM.append(this.mainColEl, DOM.$('.messaging-list'));
		this.messageListEl.style.cssText = 'flex:1;overflow-y:auto;padding:8px 0;';

		// Compose bar
		this.composeEl = DOM.append(this.mainColEl, DOM.$('.messaging-compose'));
		this.composeEl.style.cssText = 'padding:8px 16px;border-top:1px solid var(--vscode-editorWidget-border);display:flex;gap:8px;align-items:flex-end;flex-shrink:0;';

		// Channel-details side panel (hidden until toggled from the header).
		this.detailsEl = DOM.append(this.bodyRowEl, DOM.$('.messaging-details'));
		this.detailsEl.style.cssText = 'display:none;width:300px;flex-shrink:0;border-left:1px solid var(--vscode-editorWidget-border);flex-direction:column;overflow:hidden;background:var(--vscode-editor-background);';

		this._buildCompose();
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof MessagingEditorInput)) { return; }

		// Get current user
		try {
			this.currentUserId = localStorage.getItem('ciyex_user_id') || '';
		} catch { /* */ }

		// Reset the people-picker filter whenever the editor switches inputs so a
		// stale search term doesn't leak across DM conversations.
		this.peopleSearch = '';

		// Collapse the details panel when switching conversations so stale channel
		// info isn't shown against a different channel.
		this.detailsOpen = false;
		this.detailsTab = 'about';
		if (this.detailsEl) { this.detailsEl.style.display = 'none'; }

		this.channelInfo = { id: input.channelId, name: input.channelName, type: input.channelType };
		this._renderHeader(input);

		// An empty channelId means this DM editor was opened as a placeholder
		// ("New Message") — there is no conversation to load yet, so render the
		// people picker instead of polling a non-existent channel.
		if (!input.channelId) {
			this._stopPolling();
			this.messages = [];
			this._renderPeoplePicker();
			return;
		}

		// Kick off the independent channel-details fetch in parallel with the message
		// load so they don't run sequentially (threads share the parent channel, so
		// skip details for thread inputs).
		if (!input.threadParentId) {
			void this._loadChannelDetails(input.channelId);
		}
		// Load the authoritative member roster (channel-scoped, so also for threads)
		// from the dedicated endpoint — the channel-list payload's embedded members
		// can be partial, which left the @-mention popup showing only the owner.
		void this._loadChannelMembers(input.channelId);
		// Org-wide directory for the @-mention popup (staff + patients) — loaded
		// once per editor; channel switches reuse the cached list.
		void this._loadOrgDirectory();

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

		// Channel details button — opens the About / Members / Pinned / Files side
		// panel. (Replaces the former inert "Pinned messages" pin button; pinned
		// messages now live inside the details panel's Pinned tab.) Hidden for the
		// "New Message" placeholder and threads, where there is no channel.
		if (!input.threadParentId && input.channelId) {
			const infoBtn = DOM.append(this.headerEl, DOM.$('button'));
			// allow-any-unicode-next-line
			infoBtn.textContent = 'ⓘ';
			infoBtn.title = 'Channel details';
			infoBtn.style.cssText = `background:none;border:none;cursor:pointer;font-size:16px;padding:4px;border-radius:4px;color:var(--vscode-foreground);${this.detailsOpen ? 'background:var(--vscode-toolbar-hoverBackground);' : ''}`;
			infoBtn.addEventListener('click', () => this._toggleDetails());
		}
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

			// Normalize the boolean flags from the backend DTO, which names them
			// `isPinned` / `isEdited` / `isDeleted` / `isSystem` (and
			// `threadReplyCount`). The frontend Message uses `pinned` / `edited` /
			// `deleted` / `system` / `replyCount`; the old code assigned the raw rows
			// straight through, so `m.pinned` was always undefined and a pinned
			// message never entered the Pinned bar — clicking Pin looked like it did
			// nothing (QA issue 9).
			for (const m of newMessages) {
				const raw = m as unknown as Record<string, unknown>;
				m.pinned = raw.pinned === true || raw.isPinned === true || (raw.pinnedAt !== null && raw.pinnedAt !== undefined && raw.pinnedAt !== '');
				m.edited = raw.edited === true || raw.isEdited === true;
				m.deleted = raw.deleted === true || raw.isDeleted === true;
				m.system = raw.system === true || raw.isSystem === true;
				if (m.replyCount === undefined && typeof raw.threadReplyCount === 'number') { m.replyCount = raw.threadReplyCount as number; }
			}

			// Only re-render if messages changed. The signature must include the
			// per-message state that affects rendering (pinned / edited content /
			// reactions / deleted) — keying off the ID set alone meant a pin/unpin,
			// edit or reaction never re-rendered because the ID set was unchanged
			// (QA: clicking Pin did nothing).
			const sig = (list: Message[]): string => JSON.stringify(list.map(m => [
				m.id, m.pinned, m.content, m.deleted, m.updatedAt, (m.reactions ?? []).map(r => `${r.emoji}:${r.count}`),
			]));
			if (sig(newMessages) !== sig(this.messages) || newMessages.length !== this.messages.length) {
				this.messages = newMessages;
				this._renderMessages();
			}
		} catch { /* API not ready */ }
		this.loading = false;
	}

	private _renderMessages(): void {
		// Revoke object URLs from the previous render — the cards are about to be
		// rebuilt and will fetch fresh blobs.
		for (const url of this.attachmentObjectUrls) { URL.revokeObjectURL(url); }
		this.attachmentObjectUrls = [];
		DOM.clearNode(this.messageListEl);

		if (this.messages.length === 0) {
			// For a brand-new DM placeholder (no channel yet) show the searchable
			// people list so the user can pick who to message — matches EHR-UI's
			// "New Message" panel. Existing DMs with history fall through to the
			// normal message rendering below.
			if (!this._getInput()?.channelId) {
				this._renderPeoplePicker();
				return;
			}
			const empty = DOM.append(this.messageListEl, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = this.channelInfo?.type === 'dm'
				? 'Start a conversation...'
				: 'No messages yet. Say something!';
			return;
		}

		// Pinned messages pinned to the TOP of the conversation — a sticky bar that
		// stays visible above the scrolling message list, so pinned items are always
		// reachable at the top of all messages (they also remain in place below).
		const pinnedMsgs = this.messages.filter(m => m.pinned && !m.deleted && !m.system);
		if (pinnedMsgs.length > 0) {
			const bar = DOM.append(this.messageListEl, DOM.$('div'));
			bar.style.cssText = 'position:sticky;top:0;z-index:5;background:var(--vscode-editorWidget-background,rgba(127,127,127,0.06));border-bottom:1px solid var(--vscode-editorWidget-border);padding:6px 16px;backdrop-filter:blur(2px);';
			const hdr = DOM.append(bar, DOM.$('div'));
			hdr.textContent = `\u{1F4CC} Pinned (${pinnedMsgs.length})`;
			hdr.style.cssText = 'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
			for (const m of pinnedMsgs) {
				const item = DOM.append(bar, DOM.$('div'));
				item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0;font-size:12px;cursor:pointer;';
				const who = DOM.append(item, DOM.$('span'));
				who.textContent = m.senderName + ':';
				who.style.cssText = 'font-weight:600;white-space:nowrap;flex-shrink:0;';
				const txt = DOM.append(item, DOM.$('span'));
				txt.textContent = (m.content || (m.attachments && m.attachments.length ? '\u{1F4CE} Attachment' : '')).replace(/\s+/g, ' ').trim();
				txt.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-foreground);';
				// Click the pinned row → jump to the message in the conversation below.
				item.addEventListener('click', () => {
					// eslint-disable-next-line no-restricted-syntax
					const target = this.messageListEl.querySelector(`[data-msg-id="${m.id}"]`) as HTMLElement | null;
					if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
				});
				const unpin = DOM.append(item, DOM.$('button'));
				unpin.textContent = '\u{1F4CC}';
				unpin.title = 'Unpin';
				unpin.style.cssText = 'background:none;border:none;cursor:pointer;padding:0 2px;font-size:12px;flex-shrink:0;opacity:0.8;';
				unpin.addEventListener('click', (e) => { e.stopPropagation(); void this._togglePin(m.id, true); });
			}
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

	/**
	 * Fetch all messageable people (providers + patients) for the "New Message"
	 * picker. Mirrors EHR-UI's ChannelSidebar.loadUsers: hit `/api/providers` and
	 * `/api/patients` in parallel, normalise the differing shapes, prefer
	 * Keycloak id → email → fhirId/id as the DM target id, and tag each entry with
	 * its role plus a subtitle (specialty for providers, DOB for patients).
	 */
	private async _loadPeople(): Promise<void> {
		const seen = new Set<string>();
		const all: PersonEntry[] = [];

		const extractList = (json: { data?: unknown; content?: unknown }): Array<Record<string, unknown>> => {
			const payload = (json?.data ?? json) as Record<string, unknown>;
			if (Array.isArray(payload)) { return payload as Array<Record<string, unknown>>; }
			if (Array.isArray(payload?.content)) { return payload.content as Array<Record<string, unknown>>; }
			return [];
		};

		const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

		const extract = (p: Record<string, unknown>, type: PersonEntry['type']): PersonEntry | null => {
			const systemAccess = p.systemAccess as Record<string, unknown> | undefined;
			const identification = p.identification as Record<string, unknown> | undefined;
			const keycloakId = str(systemAccess?.keycloakUserId) || str(p['systemAccess.keycloakUserId']);
			const email = str(identification?.email) || str(p.email) || str(p.emailAddress)
				|| str(p.contactEmail) || str(systemAccess?.email);
			const id = keycloakId || email || str(p.fhirId) || str(p.id);
			const name = identification
				? `${str(identification.firstName)} ${str(identification.lastName)}`.trim()
				: (p.firstName || p.lastName)
					? `${str(p.firstName)} ${str(p.lastName)}`.trim()
					: str(p.name || p.displayName || p.fullName);
			if (!id || !name) { return null; }
			const dob = str(identification?.dateOfBirth) || str(p.dateOfBirth) || str(p.dob) || undefined;
			const profDetails = p.professionalDetails as Record<string, unknown> | undefined;
			const subtitle = str(profDetails?.specialty) || str(p.specialty) || undefined;
			return { id, name, type, dob: dob || undefined, subtitle: subtitle || undefined };
		};

		const [providersRes, patientsRes] = await Promise.allSettled([
			this.apiService.fetch('/api/providers?status=ACTIVE&size=200'),
			this.apiService.fetch('/api/patients?size=500'),
		]);

		const collect = async (settled: PromiseSettledResult<Response>, type: PersonEntry['type']) => {
			if (settled.status !== 'fulfilled' || !settled.value.ok) { return; }
			try {
				const json = await settled.value.json();
				for (const raw of extractList(json)) {
					const person = extract(raw, type);
					if (person && !seen.has(person.id)) {
						seen.add(person.id);
						all.push(person);
					}
				}
			} catch { /* ignore malformed payload */ }
		};

		await collect(providersRes, 'provider');
		await collect(patientsRes, 'patient');

		this.people = all;
		this.peopleLoaded = true;
	}

	private _filteredPeople(): PersonEntry[] {
		const q = this.peopleSearch.trim().toLowerCase();
		if (!q) { return this.people; }
		return this.people.filter(p => p.name.toLowerCase().includes(q));
	}

	/**
	 * Render the "New Message" people picker into the message list area: a header
	 * with the available count, a search box, and a scrollable list of people each
	 * showing avatar, name, role/DOB sub-text and a role badge. Selecting a person
	 * starts (or opens) a DM with them. Matches the EHR-UI ChannelSidebar picker.
	 */
	private _renderPeoplePicker(): void {
		DOM.clearNode(this.messageListEl);

		const wrap = DOM.append(this.messageListEl, DOM.$('div'));
		wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;';

		// Header — title + "N people available"
		const head = DOM.append(wrap, DOM.$('div'));
		head.style.cssText = 'padding:14px 16px 8px;flex-shrink:0;';
		const title = DOM.append(head, DOM.$('div'));
		title.textContent = 'New Message';
		title.style.cssText = 'font-weight:600;font-size:14px;color:var(--vscode-foreground);';
		const sub = DOM.append(head, DOM.$('div'));
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-top:2px;';

		// Search box
		const searchWrap = DOM.append(wrap, DOM.$('div'));
		searchWrap.style.cssText = 'padding:0 16px 10px;flex-shrink:0;';
		const search = DOM.append(searchWrap, DOM.$('input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Search by name...';
		search.value = this.peopleSearch;
		search.style.cssText = 'width:100%;padding:8px 12px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;outline:none;box-sizing:border-box;';
		search.addEventListener('focus', () => { search.style.borderColor = 'var(--vscode-focusBorder)'; });
		search.addEventListener('blur', () => { search.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });

		// Scrollable list
		const list = DOM.append(wrap, DOM.$('div'));
		list.style.cssText = 'flex:1;overflow-y:auto;padding:0 8px 12px;';

		const renderList = () => {
			DOM.clearNode(list);
			const people = this._filteredPeople();
			sub.textContent = this.peopleLoaded
				? `${people.length} ${people.length === 1 ? 'person' : 'people'} available`
				: 'Loading people...';

			if (people.length === 0) {
				const empty = DOM.append(list, DOM.$('div'));
				empty.style.cssText = 'padding:32px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;';
				empty.textContent = !this.peopleLoaded
					? 'Loading...'
					: this.peopleSearch ? 'No people found' : 'No people available';
				return;
			}

			for (const person of people) {
				const row = DOM.append(list, DOM.$('div'));
				row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:pointer;';
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
				row.addEventListener('mouseleave', () => { row.style.background = ''; });
				row.addEventListener('click', () => this._startDmWith(person));

				// Avatar
				const initials = person.name.split(' ').map(w => (w[0] || '')).join('').substring(0, 2).toUpperCase() || '?';
				const hue = Math.abs(person.name.split('').reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0)) % 360;
				const av = DOM.append(row, DOM.$('div'));
				av.textContent = initials;
				av.style.cssText = `width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#fff;flex-shrink:0;background:hsl(${hue},45%,45%);`;

				// Name + subtitle
				const col = DOM.append(row, DOM.$('div'));
				col.style.cssText = 'flex:1;min-width:0;';
				const nameEl = DOM.append(col, DOM.$('div'));
				nameEl.textContent = person.name;
				nameEl.style.cssText = 'font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				const subText = person.type === 'patient'
					? (person.dob ? `Patient · DOB: ${person.dob}` : 'Patient')
					: (person.subtitle || 'Provider');
				const subEl = DOM.append(col, DOM.$('div'));
				subEl.textContent = subText;
				subEl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

				// Role badge
				const badge = DOM.append(row, DOM.$('span'));
				badge.textContent = person.type === 'patient' ? 'Patient' : 'Provider';
				badge.style.cssText = `flex-shrink:0;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;${person.type === 'patient'
					? 'background:rgba(52,168,83,0.18);color:#34a853;'
					: 'background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);'}`;
			}
		};

		search.addEventListener('input', () => { this.peopleSearch = search.value; renderList(); });

		renderList();

		// Lazily load the people list the first time the picker is shown, then
		// re-render so badges/sub-text appear.
		if (!this.peopleLoaded) {
			this._loadPeople().then(() => {
				// Only re-render if the picker is still the active view.
				if (!this._getInput()?.channelId || this.messages.length === 0) {
					renderList();
				}
			}).catch(() => { this.peopleLoaded = true; renderList(); });
		}
	}

	/**
	 * Start (or open the existing) DM with the selected person via
	 * `POST /api/channels/dm`, then re-point this editor at the resulting channel
	 * so messaging works immediately. Backend resolves email/keycloak ids and
	 * returns `{ data: { id, name, type } }`.
	 */
	private async _startDmWith(person: PersonEntry): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/channels/dm', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetUserId: person.id, targetUserName: person.name }),
			});
			if (!res.ok) { return; }
			// Backend returns `{ data: { id, name, type } }` (or a bare body).
			const ch = await parseSavedRecord(res);
			const chId = ch?.id ? String(ch.id) : '';
			if (!chId) { return; }
			const chName = ch?.name ? String(ch.name) : person.name;
			const chType = ch?.type ? String(ch.type) : 'dm';

			// Re-point the current editor at the real DM channel and load it.
			this.channelInfo = { id: chId, name: chName, type: chType };
			const input = this._getInput();
			if (input) {
				// Mutate the input's channel identifiers so subsequent sends/polls
				// target the resolved channel even though we keep the same editor.
				(input as { channelId: string }).channelId = chId;
				(input as { channelName: string }).channelName = chName;
				(input as { channelType: string }).channelType = chType;
				this._renderHeader(input);
				await this._loadMessages(chId, input.threadParentId);
				this.apiService.fetch(`/api/channels/${chId}/read`, { method: 'POST' }).catch(() => { });

				// Begin polling the now-real channel.
				this._stopPolling();
				// eslint-disable-next-line no-restricted-globals
				this.pollTimer = setInterval(() => {
					if (!this.loading) {
						this._loadMessages(chId, input.threadParentId);
					}
				}, 5000);
			}
		} catch { /* failed to start DM */ }
	}

	private _renderMessage(msg: Message, container: HTMLElement = this.messageListEl): void {
		const row = DOM.append(container, DOM.$('div'));
		row.setAttribute('data-msg-id', String(msg.id));
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

		// Content — skip the element entirely for attachment-only messages so they
		// don't leave an empty gap above the attachment cards.
		if (msg.content) {
			const content = DOM.append(col, DOM.$('div'));
			content.style.cssText = 'margin-top:2px;line-height:1.5;word-break:break-word;white-space:pre-wrap;';
			this._renderRichContent(content, msg.content);
		}

		// Attachments. `fileUrl` is a relative, auth-protected proxy path, so we
		// can't point <img>/<a> straight at it (wrong origin + no Bearer header).
		// Each attachment's bytes are fetched through the API service and turned
		// into a short-lived object URL for inline display / download.
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
					// Inline thumbnail — load the bytes through the authenticated
					// proxy then swap in the object URL once it resolves.
					const img = DOM.append(card, DOM.$('img')) as HTMLImageElement;
					img.alt = att.fileName;
					img.style.cssText = 'width:100%;max-height:160px;object-fit:cover;display:block;background:var(--vscode-editorWidget-background);min-height:60px;';
					img.addEventListener('error', () => { img.style.display = 'none'; });
					this._loadAttachmentObjectUrl(att.fileUrl).then(objUrl => {
						if (objUrl) {
							img.src = objUrl;
							// Click → open full-size in a lightbox overlay.
							card.addEventListener('click', () => this._showImagePreview(objUrl, att.fileName));
						} else {
							img.style.display = 'none';
						}
					});
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
					card.addEventListener('click', async () => {
						// Download through the authenticated proxy, then save via a
						// transient object URL (the proxy path needs a Bearer header
						// a plain anchor cannot send).
						const objUrl = await this._loadAttachmentObjectUrl(att.fileUrl);
						if (!objUrl) { return; }
						const a = document.createElement('a');
						a.href = objUrl;
						a.download = att.fileName;
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

		// Highlighting is done via the `.messaging-hover-action:hover` CSS rule rather
		// than JS mouseenter/mouseleave — when the action bar is hidden while the
		// pointer sits on a button, mouseleave never fires and the JS-set background
		// stays stuck, so several icons end up highlighted at once.
		for (const emoji of QUICK_REACTIONS.slice(0, 3)) {
			const btn = DOM.append(hoverActions, DOM.$('button.messaging-hover-action'));
			btn.textContent = emoji;
			btn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			btn.addEventListener('click', () => this._toggleReaction(msg.id, emoji));
		}

		// Reply button
		if (!this._getInput()?.threadParentId) {
			const replyBtn = DOM.append(hoverActions, DOM.$('button.messaging-hover-action'));
			// allow-any-unicode-next-line
			replyBtn.textContent = '💬';
			replyBtn.title = 'Reply in thread';
			replyBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			replyBtn.addEventListener('click', () => {
				const inp = this._getInput();
				if (inp) {
					this.commandService.executeCommand('ciyex.messaging.openThread', inp.channelId, msg.id, inp.channelName);
				}
			});
		}

		// Pin button
		const pinBtn = DOM.append(hoverActions, DOM.$('button.messaging-hover-action'));
		// allow-any-unicode-next-line
		pinBtn.textContent = '📌';
		pinBtn.title = msg.pinned ? 'Unpin' : 'Pin';
		pinBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
		pinBtn.addEventListener('click', () => this._togglePin(msg.id, msg.pinned));

		// Edit button (only for own messages)
		if (msg.senderId === this.currentUserId) {
			const editBtn = DOM.append(hoverActions, DOM.$('button.messaging-hover-action'));
			// allow-any-unicode-next-line
			editBtn.textContent = '✏️';
			editBtn.title = 'Edit';
			editBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			editBtn.addEventListener('click', () => this._editMessage(msg.id, msg.content));

			const delBtn = DOM.append(hoverActions, DOM.$('button.messaging-hover-action'));
			// allow-any-unicode-next-line
			delBtn.textContent = '🗑️';
			delBtn.title = 'Delete';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:2px 4px;font-size:14px;border-radius:4px;';
			delBtn.addEventListener('click', () => this._deleteMessage(msg.id));
		}
	}

	private _buildCompose(): void {
		// Switch compose layout to a column so the toolbar sits above the input.
		// `position:relative` anchors the absolutely-positioned @-mention popup.
		this.composeEl.style.cssText = 'position:relative;padding:8px 16px;border-top:1px solid var(--vscode-editorWidget-border);display:flex;flex-direction:column;gap:6px;flex-shrink:0;';

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

		// Pending-attachment preview tray — sits between the toolbar and the input
		// row. Hidden until at least one file is staged; shows image thumbnails /
		// file chips each with a remove button.
		this.attachmentsPreviewEl = DOM.append(this.composeEl, DOM.$('.messaging-attachments-preview'));
		this.attachmentsPreviewEl.style.cssText = 'display:none;flex-wrap:wrap;gap:8px;padding:4px 0;';

		// Input row: attach + textarea + send
		const inputRow = DOM.append(this.composeEl, DOM.$('.messaging-input-row'));
		inputRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end;';

		// Attach button — opens a small Image / File / Camera menu instead of
		// jumping straight to the OS file picker (Issue #7 — matches the
		// EHR-UI's three-option attachment popover).
		const attachWrap = DOM.append(inputRow, DOM.$('div'));
		attachWrap.style.cssText = 'position:relative;flex-shrink:0;';
		// Use the themed VS Code paperclip codicon instead of a coloured emoji so the
		// attach icon matches the rest of the workbench UI and follows the theme.
		const attachBtn = DOM.append(attachWrap, DOM.$('button.codicon.codicon-attach'));
		attachBtn.title = 'Attach';
		attachBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;padding:4px;color:var(--vscode-foreground);display:flex;align-items:center;';
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
		// Three distinct pickers matching the EHR-UI attachment popover. Image =
		// pictures only; File = any file type; Camera = capture a photo directly.
		// allow-any-unicode-next-line
		mkAttachOpt('🖼', 'Image', () => this._attachFile('image/*'));
		// allow-any-unicode-next-line
		mkAttachOpt('📎', 'File', () => this._attachFile('*/*'));
		// allow-any-unicode-next-line
		mkAttachOpt('📷', 'Camera', () => this._capturePhoto());
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
		// @-mention popup — lists channel members as the user types "@", like a
		// Slack/WhatsApp group mention. Anchored above the input via composeEl's
		// relative positioning; hidden until an "@query" matches a member.
		this.mentionDropdownEl = DOM.append(this.composeEl, DOM.$('.messaging-mention-popup'));
		this.mentionDropdownEl.style.cssText = 'position:absolute;left:16px;bottom:52px;min-width:220px;max-width:340px;max-height:200px;overflow-y:auto;background:var(--vscode-dropdown-background,var(--vscode-editorWidget-background));border:1px solid var(--vscode-dropdown-border,var(--vscode-editorWidget-border));border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.25);z-index:1600;display:none;padding:4px 0;';

		// Recompute the @-mention state on every content change.
		this.inputEl.addEventListener('input', () => this._updateMentionAutocomplete());
		// Close the popup when clicking outside the input or the popup itself.
		DOM.getActiveWindow().document.addEventListener('mousedown', (e) => {
			const t = e.target as Node;
			if (this.mentionState && !this.inputEl.contains(t) && !this.mentionDropdownEl?.contains(t)) {
				this._closeMention();
			}
		});

		this.inputEl.addEventListener('keydown', (e) => {
			// When the @-mention popup is open, arrows navigate it and Enter/Tab
			// pick the highlighted member instead of sending / inserting a newline.
			if (this.mentionState) {
				if (e.key === 'ArrowDown') { e.preventDefault(); this._moveMentionSelection(1); return; }
				if (e.key === 'ArrowUp') { e.preventDefault(); this._moveMentionSelection(-1); return; }
				if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this._commitMention(this.mentionState.matches[this.mentionState.activeIndex]); return; }
				if (e.key === 'Escape') { e.preventDefault(); this._closeMention(); return; }
			}
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
	 * Detect an in-progress "@query" at the caret and (re)open the member-mention
	 * popup with the channel members that match it. Closes the popup when the caret
	 * isn't on an "@token", when nothing matches, or when the channel has no members.
	 */
	private _updateMentionAutocomplete(): void {
		if (!this.mentionDropdownEl) { return; }
		const members = this._mentionCandidates();
		if (members.length === 0) { this._closeMention(); return; }
		const win = DOM.getActiveWindow();
		const sel = win.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) { this._closeMention(); return; }
		const range = sel.getRangeAt(0);
		const node = range.startContainer;
		if (node.nodeType !== Node.TEXT_NODE) { this._closeMention(); return; }
		const textNode = node as Text;
		const caretIndex = range.startOffset;
		const before = (textNode.textContent || '').slice(0, caretIndex);
		// "@" must start the input or follow whitespace; the query that follows has
		// no spaces (a single mention token), e.g. "@vi" anchored to the caret.
		const m = /(?:^|\s)@([^\s@]*)$/.exec(before);
		if (!m) { this._closeMention(); return; }
		const query = m[1];
		const atIndex = caretIndex - query.length - 1;
		const ql = query.toLowerCase();
		// No hard row cap — the popup itself is height-capped and scrolls, and a
		// bare "@" should list every mentionable person in the org.
		const matches = members
			.filter(mem => !ql || mem.displayName.toLowerCase().includes(ql));
		if (matches.length === 0) { this._closeMention(); return; }
		this.mentionState = { node: textNode, atIndex, caretIndex, query, matches, activeIndex: 0 };
		this._renderMentionDropdown();
	}

	/** Render the member rows of the open @-mention popup (highlighting the active row). */
	private _renderMentionDropdown(): void {
		const st = this.mentionState;
		const el = this.mentionDropdownEl;
		if (!st || !el) { return; }
		DOM.clearNode(el);
		st.matches.forEach((mem, i) => {
			const row = DOM.append(el, DOM.$('.messaging-mention-item'));
			row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:var(--vscode-foreground);background:${i === st.activeIndex ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent'};`;
			const av = DOM.append(row, DOM.$('span'));
			const initials = mem.avatar?.initials || mem.displayName.split(/\s+/).map(p => p[0] || '').join('').slice(0, 2).toUpperCase();
			av.textContent = initials;
			// Avatar colour from the API is a Tailwind class (not CSS), so use the
			// theme badge colours here for a valid, theme-consistent swatch.
			av.style.cssText = 'width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--vscode-badge-foreground);background:var(--vscode-badge-background);flex-shrink:0;';
			const name = DOM.append(row, DOM.$('span'));
			name.textContent = mem.displayName;
			name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			if (mem.role) {
				const role = DOM.append(row, DOM.$('span'));
				role.textContent = mem.role;
				role.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);text-transform:capitalize;flex-shrink:0;';
			}
			row.addEventListener('mouseenter', () => { st.activeIndex = i; this._renderMentionDropdown(); });
			// Keep the caret/selection in the input so insertion targets the right spot.
			row.addEventListener('mousedown', (e) => { e.preventDefault(); });
			row.addEventListener('click', () => this._commitMention(mem));
		});
		el.style.display = 'block';
	}

	/** Move the @-mention popup highlight by `delta`, wrapping around the list. */
	private _moveMentionSelection(delta: number): void {
		const st = this.mentionState;
		if (!st) { return; }
		const n = st.matches.length;
		st.activeIndex = (st.activeIndex + delta + n) % n;
		this._renderMentionDropdown();
	}

	/**
	 * Replace the in-progress "@query" with the chosen member's full name (followed
	 * by a trailing space) and place the caret after it. The plain "@Name" text
	 * is rendered as a mention chip by {@link _parseRichText} on send.
	 */
	private _commitMention(member: ChannelMember | undefined): void {
		const st = this.mentionState;
		if (!st || !member) { this._closeMention(); return; }
		const node = st.node;
		const full = node.textContent || '';
		const before = full.slice(0, st.atIndex);
		const after = full.slice(st.caretIndex);
		const insert = `@${member.displayName} `;
		node.textContent = before + insert + after;
		const win = DOM.getActiveWindow();
		const sel = win.getSelection();
		if (sel) {
			const range = win.document.createRange();
			const offset = Math.min((before + insert).length, (node.textContent || '').length);
			range.setStart(node, offset);
			range.collapse(true);
			sel.removeAllRanges();
			sel.addRange(range);
		}
		this._closeMention();
		this.inputEl.focus();
	}

	/** Hide and reset the @-mention popup. */
	private _closeMention(): void {
		this.mentionState = null;
		if (this.mentionDropdownEl) { this.mentionDropdownEl.style.display = 'none'; }
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
		if (!input) { return; }
		const text = this._getInputText();
		const attachments = this.pendingAttachments;
		const hasAttachments = attachments.length > 0;
		// Allow sending when there is text OR at least one staged attachment.
		if (!text && !hasAttachments) { return; }

		// For attachment-only messages send an empty body — the rendered file
		// cards/thumbnails are the message, so we no longer post a "Attached N
		// file(s)" placeholder that hid the actual images/documents.
		const content = text;
		this.pendingAttachments = [];
		this._clearInput();
		this._renderAttachmentPreviews();

		try {
			const body: Record<string, string> = { content };
			if (input.threadParentId) {
				body.parentId = input.threadParentId;
			}

			const msgRes = await this.apiService.fetch(`/api/channels/${input.channelId}/messages`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			// Optimistic instant reflect: append the sent message to the thread the
			// moment the POST succeeds (parse the saved record, fall back to a locally
			// built one) so it shows without waiting on a refetch round-trip. The
			// background reconcile below then pulls the canonical message (server id,
			// attachment cards, reactions). Skip the optimistic append for
			// attachment-only sends — the attachment cards only exist after the
			// reconcile, so let the background reload render the real message.
			if (msgRes.ok && content && !hasAttachments) {
				const saved = await parseSavedRecord(msgRes);
				const optimistic: Message = {
					id: String(saved?.id ?? `local-${Date.now()}`),
					channelId: input.channelId,
					senderId: String(saved?.senderId ?? this.currentUserId),
					senderName: String(saved?.senderName ?? 'You'),
					content: String(saved?.content ?? content),
					parentId: input.threadParentId,
					pinned: false,
					edited: false,
					deleted: false,
					system: false,
					createdAt: String(saved?.createdAt ?? new Date().toISOString()),
				};
				// Don't double-add if a poll already raced in the real message.
				if (!this.messages.some(m => m.id === optimistic.id)) {
					this.messages = [...this.messages, optimistic];
					this._renderMessages();
				}
			}

			// Upload each staged attachment against the freshly-created message.
			if (hasAttachments && msgRes.ok) {
				const msgData = await msgRes.json();
				const messageId = msgData?.data?.id || msgData?.id;
				if (messageId) {
					// Raw fetch: ICiyexApiService.fetch forces application/json which
					// breaks multipart (the browser can't add the boundary), so post
					// the FormData directly with the auth headers.
					const token = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_token') : '') || '';
					const tenant = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_selected_tenant') || localStorage.getItem('ciyex_tenant') : '') || '';
					for (const file of attachments) {
						const formData = new FormData();
						formData.append('file', file);
						await fetch(`${this.apiService.apiUrl}/api/messages/${messageId}/attachments`, {
							method: 'POST',
							headers: {
								'Authorization': `Bearer ${token}`,
								...(tenant ? { 'X-Tenant-Name': tenant } : {}),
							},
							body: formData,
						});
					}
				}
			}

			// Reconcile in the background (non-blocking) so the optimistic message is
			// replaced by the canonical server copy without holding up the UI.
			void this._loadMessages(input.channelId, input.threadParentId);
		} catch { /* failed to send */ }
	}

	private async _toggleReaction(messageId: string, emoji: string): Promise<void> {
		try {
			await this.apiService.fetch(`/api/messages/${messageId}/reactions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emoji }),
			});
			// Reconcile in the background so the reaction badge updates without blocking.
			const input = this._getInput();
			if (input) { void this._loadMessages(input.channelId, input.threadParentId); }
		} catch { /* */ }
	}

	private async _togglePin(messageId: string, currentlyPinned: boolean): Promise<void> {
		const msg = this.messages.find(m => m.id === messageId);
		const next = !currentlyPinned;
		// Flip + re-render FIRST so the click has an immediate effect (the message
		// jumps into the Pinned bar at the top). Previously the optimistic update was
		// gated behind res.ok, so a failed/slow request made clicking Pin look like it
		// did nothing. We revert below if the server rejects it.
		if (msg) { msg.pinned = next; }
		this._renderMessages();
		if (this.detailsOpen && this.detailsTab === 'pinned') { void this._renderDetails(); }
		try {
			const res = await this.apiService.fetch(`/api/messages/${messageId}/pin`, {
				method: currentlyPinned ? 'DELETE' : 'POST',
			});
			if (!res.ok) {
				// Roll back the optimistic change and tell the user it didn't stick.
				if (msg) { msg.pinned = currentlyPinned; }
				this._renderMessages();
				if (this.detailsOpen && this.detailsTab === 'pinned') { void this._renderDetails(); }
				this.notificationService.notify({ severity: Severity.Warning, message: `Could not ${next ? 'pin' : 'unpin'} the message (HTTP ${res.status}).` });
				return;
			}
			// Reconcile in the background — the pin state is already reflected above.
			const input = this._getInput();
			if (input) { void this._loadMessages(input.channelId, input.threadParentId); }
		} catch {
			if (msg) { msg.pinned = currentlyPinned; }
			this._renderMessages();
			this.notificationService.notify({ severity: Severity.Warning, message: `Could not ${next ? 'pin' : 'unpin'} the message (network error).` });
		}
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
		fileInput.addEventListener('change', () => {
			const files = fileInput.files;
			if (!files || files.length === 0) { return; }
			this._addPendingAttachments(Array.from(files));
		});
		fileInput.click();
	}

	// Stage picked/captured files in the preview tray instead of uploading them
	// straight away. They are sent (and uploaded) only when the user hits Send,
	// giving them a chance to preview and remove attachments first.
	private _addPendingAttachments(files: File[]): void {
		if (files.length === 0) { return; }
		this.pendingAttachments.push(...files);
		this._renderAttachmentPreviews();
		this.inputEl?.focus();
	}

	// (Re)build the preview tray from `pendingAttachments`. Images get a clickable
	// thumbnail (opens the full-screen lightbox); other files get a paperclip chip.
	private _renderAttachmentPreviews(): void {
		if (!this.attachmentsPreviewEl) { return; }
		// Revoke any object URLs from the previous render to avoid leaks.
		for (const url of this.pendingPreviewUrls) { URL.revokeObjectURL(url); }
		this.pendingPreviewUrls = [];
		DOM.clearNode(this.attachmentsPreviewEl);

		if (this.pendingAttachments.length === 0) {
			this.attachmentsPreviewEl.style.display = 'none';
			return;
		}
		this.attachmentsPreviewEl.style.display = 'flex';

		this.pendingAttachments.forEach((file, index) => {
			const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(file.name);
			const chip = DOM.append(this.attachmentsPreviewEl, DOM.$('.messaging-pending-attachment'));
			chip.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:6px;width:96px;';

			if (isImage) {
				const url = URL.createObjectURL(file);
				this.pendingPreviewUrls.push(url);
				const img = DOM.append(chip, DOM.$('img')) as HTMLImageElement;
				img.src = url;
				img.alt = file.name;
				img.title = 'Click to preview';
				img.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:4px;cursor:zoom-in;';
				img.addEventListener('click', () => this._showImagePreview(url, file.name));
			} else {
				const icon = DOM.append(chip, DOM.$('span'));
				// allow-any-unicode-next-line
				icon.textContent = '\u{1F4CE}';
				icon.style.cssText = 'font-size:34px;line-height:80px;';
			}

			const name = DOM.append(chip, DOM.$('span'));
			name.textContent = file.name;
			name.title = file.name;
			name.style.cssText = 'font-size:11px;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-foreground);';

			const size = DOM.append(chip, DOM.$('span'));
			size.textContent = this._formatSize(file.size);
			size.style.cssText = 'font-size:10px;color:var(--vscode-descriptionForeground);';

			// Remove button — drops this file from the staged list before sending.
			const remove = DOM.append(chip, DOM.$('button'));
			// allow-any-unicode-next-line
			remove.textContent = '✕';
			remove.title = 'Remove';
			remove.style.cssText = 'position:absolute;top:-6px;right:-6px;width:18px;height:18px;border-radius:50%;border:none;background:var(--vscode-badge-background,#555);color:var(--vscode-badge-foreground,#fff);font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;';
			remove.addEventListener('click', () => {
				this.pendingAttachments.splice(index, 1);
				this._renderAttachmentPreviews();
			});
		});
	}

	// Open the device camera in a modal, capture a still frame and attach it as a
	// JPEG. Uses getUserMedia because the file-input `capture` attribute is
	// ignored on desktop Electron (there it just reopens the OS file picker).
	private _capturePhoto(): void {
		const nav = mainWindow.navigator;
		if (!nav?.mediaDevices?.getUserMedia) {
			// No camera API available — fall back to the file picker.
			this._attachFile('image/*', true);
			return;
		}

		const overlay = document.createElement('div');
		overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;';

		const video = document.createElement('video');
		video.autoplay = true;
		video.muted = true;
		video.playsInline = true;
		video.style.cssText = 'max-width:80vw;max-height:65vh;border-radius:8px;background:#000;';
		overlay.appendChild(video);

		const btnRow = document.createElement('div');
		btnRow.style.cssText = 'display:flex;gap:12px;';
		overlay.appendChild(btnRow);
		const mkBtn = (label: string, bg: string): HTMLButtonElement => {
			const b = document.createElement('button');
			b.textContent = label;
			b.style.cssText = `padding:8px 22px;border:none;border-radius:6px;font-size:13px;cursor:pointer;color:#fff;background:${bg};`;
			btnRow.appendChild(b);
			return b;
		};
		const captureBtn = mkBtn('Capture', 'var(--vscode-button-background,#0e639c)');
		const cancelBtn = mkBtn('Cancel', 'rgba(255,255,255,0.2)');

		let stream: MediaStream | undefined;
		const cleanup = () => {
			if (stream) { stream.getTracks().forEach(t => t.stop()); }
			overlay.remove();
		};

		cancelBtn.addEventListener('click', cleanup);
		captureBtn.addEventListener('click', () => {
			const w = video.videoWidth;
			const h = video.videoHeight;
			if (!w || !h) { cleanup(); return; }
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			const ctx = canvas.getContext('2d');
			if (!ctx) { cleanup(); return; }
			ctx.drawImage(video, 0, 0, w, h);
			canvas.toBlob((blob) => {
				cleanup();
				if (!blob) { return; }
				const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
				this._addPendingAttachments([file]);
			}, 'image/jpeg', 0.92);
		});

		mainWindow.document.body.appendChild(overlay);

		// `facingMode: 'user'` is a soft hint — picks the front camera on phones and
		// simply uses the built-in/USB webcam on laptops & desktops (the only one).
		nav.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
			.then(s => { stream = s; video.srcObject = s; })
			.catch(() => { cleanup(); /* permission denied / no camera */ });
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
				const res = await this.apiService.fetch(`/api/messages/${messageId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: newContent }),
				});
				if (res.ok) {
					// Optimistic instant reflect: patch the edited message in place so the
					// new content + "(edited)" badge show immediately, then reconcile in
					// the background.
					const saved = await parseSavedRecord(res);
					const msg = this.messages.find(m => m.id === messageId);
					if (msg) {
						msg.content = String(saved?.content ?? newContent);
						msg.edited = true;
						this._renderMessages();
					}
				}
				const input = this._getInput();
				if (input) { void this._loadMessages(input.channelId, input.threadParentId); }
			} catch { /* edit failed */ }

			// Restore original send
			this._sendMessage = originalSend;
		};
	}

	private async _deleteMessage(messageId: string): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/messages/${messageId}`, { method: 'DELETE' });
			if (res.ok) {
				// Optimistic instant reflect: mark the message deleted so the
				// "[This message was deleted]" placeholder shows right away, then
				// reconcile in the background.
				const msg = this.messages.find(m => m.id === messageId);
				if (msg) { msg.deleted = true; this._renderMessages(); }
			}
			const input = this._getInput();
			if (input) { void this._loadMessages(input.channelId, input.threadParentId); }
		} catch { /* delete failed */ }
	}

	// Parse @mentions and **bold** / __underline__ / _italic_ / ~~strike~~ / `code` into DOM nodes
	// without innerHTML (VS Code's Trusted Types policy throws on direct innerHTML string assignment).
	// Order matters: longer markers (** , __, ~~) must be tested before single-char counterparts.
	private _renderRichContent(container: HTMLElement, text: string): void {
		// Known full names (e.g. "Shin Chan", "Victor A") let a mention span more
		// than one word: the bare `@(\w+)` regex stops at the first space, so
		// "@Shin Chan" would only highlight "Shin" and the last name (the second
		// word) was dropped — the reported "only the first word is recognized" bug.
		// We match the longest known name that follows the "@" and highlight it
		// whole. Candidate names come from the channel members AND the message
		// senders AND the loaded people directory: `channelInfo.members` is
		// populated asynchronously (after the first message render), so relying on
		// it alone left every mention first-word-only until members arrived. Message
		// senders cover exactly the people most likely to be @mentioned.
		const nameSet = new Set<string>();
		for (const m of (this.channelInfo?.members ?? [])) {
			const dn = (m.displayName || '').trim();
			if (dn) { nameSet.add(dn); }
		}
		for (const msg of this.messages) {
			const sn = (msg.senderName || '').trim();
			if (sn) { nameSet.add(sn); }
		}
		for (const p of this.people) {
			const pn = (p.name || '').trim();
			if (pn) { nameSet.add(pn); }
		}
		const memberNames = Array.from(nameSet).sort((a, b) => b.length - a.length);
		const pattern = /@(\w+)|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|_(.+?)_|`(.+?)`/g;
		let lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			if (match.index > lastIndex) {
				container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
			}
			const [full, mention, bold, underline, strike, italic, code] = match;
			if (mention !== undefined) {
				// Extend the mention to the full member name when the text after "@"
				// begins with a known multi-word display name.
				let mentionText = mention;
				const afterAt = text.slice(match.index + 1);
				const fullName = memberNames.find(n => afterAt.toLowerCase().startsWith(n.toLowerCase()));
				if (fullName && fullName.length > mention.length) {
					mentionText = afterAt.slice(0, fullName.length);
				}
				const span = DOM.append(container, DOM.$('span'));
				span.textContent = `@${mentionText}`;
				span.style.cssText = 'background:rgba(0,122,204,0.15);color:var(--vscode-textLink-foreground);padding:0 2px;border-radius:3px;';
				lastIndex = match.index + 1 + mentionText.length;
				pattern.lastIndex = lastIndex;
				continue;
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

	// Fetch an attachment's bytes through the authenticated API proxy and wrap
	// them in an object URL. The raw `fileUrl` is a relative, Bearer-protected
	// path that an <img>/<a> cannot load directly. Returns undefined on failure.
	private async _loadAttachmentObjectUrl(fileUrl: string): Promise<string | undefined> {
		try {
			const res = await this.apiService.fetch(fileUrl);
			if (!res.ok) { return undefined; }
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			this.attachmentObjectUrls.push(url);
			return url;
		} catch {
			return undefined;
		}
	}

	private _formatSize(bytes: number): string {
		if (bytes < 1024) { return `${bytes} B`; }
		if (bytes < 1048576) { return `${(bytes / 1024).toFixed(1)} KB`; }
		return `${(bytes / 1048576).toFixed(1)} MB`;
	}

	/** Fetch the channel's full metadata (members, created date, topic) from the
	 *  channel list — there is no single-channel GET endpoint — and merge it into
	 *  `channelInfo`. Re-renders the details panel if it is currently open. */
	private async _loadChannelDetails(channelId: string): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/channels');
			if (!res.ok) { return; }
			const data = await res.json();
			const list: Array<Record<string, unknown>> = data?.data || data?.content || data || [];
			const ch = Array.isArray(list) ? list.find(c => c.id === channelId) : undefined;
			if (!ch) { return; }
			// Ignore a response that arrived after the user switched channels.
			if (this.channelInfo?.id !== channelId) { return; }
			this.channelInfo = {
				...this.channelInfo,
				id: String(ch.id),
				name: String(ch.name ?? this.channelInfo.name),
				type: String(ch.type ?? this.channelInfo.type),
				topic: (ch.topic as string) ?? this.channelInfo.topic,
				description: ch.description as string | undefined,
				createdAt: ch.createdAt as string | undefined,
				createdBy: ch.createdBy as string | undefined,
				memberCount: ch.memberCount as number | undefined,
				// Keep whichever roster is fuller: the dedicated /members endpoint
				// (loaded in parallel) is authoritative, so don't let a partial
				// embedded list from /api/channels overwrite it.
				members: (Array.isArray(ch.members) && (ch.members as ChannelMember[]).length >= (this.channelInfo.members?.length ?? 0))
					? ch.members as ChannelMember[]
					: this.channelInfo.members,
			};
			if (this.detailsOpen) { this._renderDetails(); }
			// Re-parse @mentions in already-rendered messages now that the member
			// names are available, so multi-word mentions stop being clipped to
			// their first word once member details arrive. Guard on a rendered
			// message existing so we never clobber the New Message people picker.
			// eslint-disable-next-line no-restricted-syntax
			if (this.messageListEl.querySelector('[data-msg-id]')) { this._renderMessages(); }
		} catch { /* API not ready */ }
	}

	/**
	 * Fetch the channel's full member roster from the dedicated
	 * `GET /api/channels/{id}/members` endpoint and store it on `channelInfo`.
	 * This is the authoritative source for the @-mention popup — the channel-list
	 * payload's embedded `members` can be partial (it left the popup listing only
	 * the channel owner).
	 */
	private async _loadChannelMembers(channelId: string): Promise<void> {
		try {
			const res = await this.apiService.fetch(`/api/channels/${channelId}/members`);
			if (!res.ok) { return; }
			const data = await res.json();
			const list: Array<Record<string, unknown>> = data?.data || data?.content || (Array.isArray(data) ? data : []);
			if (!Array.isArray(list) || list.length === 0) { return; }
			// Ignore a response that arrived after the user switched channels.
			if (this.channelInfo?.id !== channelId) { return; }
			this.channelInfo.members = list.map(m => ({
				userId: String(m.userId ?? ''),
				displayName: String(m.displayName ?? m.userId ?? ''),
				role: m.role as string | undefined,
				joinedAt: m.joinedAt as string | undefined,
				avatar: m.avatar as ChannelMember['avatar'],
			}));
			this.channelInfo.memberCount = this.channelInfo.members.length;
			if (this.detailsOpen) { this._renderDetails(); }
			// eslint-disable-next-line no-restricted-syntax
			if (this.messageListEl.querySelector('[data-msg-id]')) { this._renderMessages(); }
		} catch { /* API not ready */ }
	}

	/**
	 * Fetch the org-wide people directory for the @-mention popup: staff via
	 * `/api/admin/users` and patients via `/api/patients` — the same endpoints the
	 * add-people picker uses. The channel roster alone can be just the owner, but
	 * every org user (provider, nurse, patient, …) should be mentionable. Either
	 * fetch failing (e.g. no admin scope) degrades to whatever the other returned.
	 */
	private async _loadOrgDirectory(): Promise<void> {
		if (this.orgDirectoryLoaded) { return; }
		this.orgDirectoryLoaded = true;
		const staff = async (): Promise<ChannelMember[]> => {
			try {
				const res = await this.apiService.fetch('/api/admin/users?page=0&size=100');
				if (!res.ok) { return []; }
				const data = await res.json();
				const users = (data?.data || data?.content || data || []) as Array<{ id: string; firstName?: string; lastName?: string; email?: string; roles?: string[] }>;
				return users.filter(u => u.id).map(u => ({
					userId: u.id,
					displayName: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u.id,
					role: (u.roles?.[0] || 'staff').toLowerCase().replace(/_/g, ' '),
				}));
			} catch { return []; }
		};
		const patients = async (): Promise<ChannelMember[]> => {
			try {
				const res = await this.apiService.fetch('/api/patients?page=0&size=100');
				if (!res.ok) { return []; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<{ id?: string; fhirId?: string; firstName?: string; lastName?: string }>;
				return list.map(p => ({
					userId: String(p.fhirId || p.id || ''),
					displayName: `${p.firstName || ''} ${p.lastName || ''}`.trim() || String(p.fhirId || p.id || ''),
					role: 'patient',
				})).filter(c => c.userId);
			} catch { return []; }
		};
		const [s, p] = await Promise.all([staff(), patients()]);
		this.orgDirectory = [...s, ...p];
		// If the user already has the @-popup open, fold the new names in live.
		if (this.mentionState) { this._updateMentionAutocomplete(); }
	}

	/**
	 * Build the @-mention candidate list: the channel's members merged with anyone
	 * who has posted in the channel plus the org-wide directory (staff + patients),
	 * deduped by display name — so every org user is mentionable even when the
	 * membership roster is sparse. Channel-roster entries win the dedup so their
	 * role labels (owner/member) are kept.
	 */
	private _mentionCandidates(): ChannelMember[] {
		const byName = new Map<string, ChannelMember>();
		for (const m of (this.channelInfo?.members ?? [])) {
			const dn = (m.displayName || '').trim();
			if (dn) { byName.set(dn.toLowerCase(), m); }
		}
		for (const msg of this.messages) {
			const sn = (msg.senderName || '').trim();
			if (sn && !byName.has(sn.toLowerCase())) {
				byName.set(sn.toLowerCase(), { userId: msg.senderId, displayName: sn });
			}
		}
		for (const person of this.orgDirectory) {
			const dn = person.displayName.trim();
			if (dn && !byName.has(dn.toLowerCase())) {
				byName.set(dn.toLowerCase(), person);
			}
		}
		return Array.from(byName.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
	}

	/** Show/hide the channel-details side panel. */
	private _toggleDetails(): void {
		this.detailsOpen = !this.detailsOpen;
		this.detailsEl.style.display = this.detailsOpen ? 'flex' : 'none';
		if (this.detailsOpen) { this._renderDetails(); }
		// Reflect the toggled state on the header info button.
		const input = this._getInput();
		if (input) { this._renderHeader(input); }
	}

	/** Render the channel-details side panel: header, tab strip and active tab. */
	private _renderDetails(): void {
		DOM.clearNode(this.detailsEl);
		const ch = this.channelInfo;
		if (!ch) { return; }

		// Panel header: name + close button.
		const head = DOM.append(this.detailsEl, DOM.$('div'));
		head.style.cssText = 'display:flex;align-items:center;gap:6px;padding:12px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const title = DOM.append(head, DOM.$('span'));
		// allow-any-unicode-next-line
		title.textContent = `${ch.type === 'dm' ? '👤' : '#'} ${ch.name}`;
		title.style.cssText = 'font-weight:700;font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
		const closeBtn = DOM.append(head, DOM.$('span')) as HTMLElement;
		// allow-any-unicode-next-line
		closeBtn.textContent = '✕';
		closeBtn.title = 'Close';
		closeBtn.style.cssText = 'cursor:pointer;font-size:14px;color:var(--vscode-descriptionForeground);padding:2px 6px;border-radius:4px;';
		closeBtn.addEventListener('click', () => this._toggleDetails());

		// Tab strip.
		const tabs = DOM.append(this.detailsEl, DOM.$('div'));
		tabs.style.cssText = 'display:flex;border-bottom:1px solid var(--vscode-editorWidget-border);flex-shrink:0;';
		const tabDefs: Array<{ id: 'about' | 'members' | 'pinned' | 'files'; label: string }> = [
			{ id: 'about', label: 'About' },
			{ id: 'members', label: 'Members' },
			{ id: 'pinned', label: 'Pinned' },
			{ id: 'files', label: 'Files' },
		];
		for (const t of tabDefs) {
			const active = this.detailsTab === t.id;
			const tab = DOM.append(tabs, DOM.$('button'));
			tab.textContent = t.label;
			tab.style.cssText = `flex:1;padding:8px 4px;background:none;border:none;border-bottom:2px solid ${active ? 'var(--vscode-focusBorder)' : 'transparent'};color:${active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};font-size:12px;font-weight:${active ? '600' : '400'};cursor:pointer;`;
			tab.addEventListener('click', () => { this.detailsTab = t.id; this._renderDetails(); });
		}

		// Tab body.
		const bodyEl = DOM.append(this.detailsEl, DOM.$('div'));
		bodyEl.style.cssText = 'flex:1;overflow-y:auto;padding:16px 14px;';
		switch (this.detailsTab) {
			case 'about': this._renderAboutTab(bodyEl); break;
			case 'members': this._renderMembersTab(bodyEl); break;
			case 'pinned': void this._renderPinnedTab(bodyEl); break;
			case 'files': this._renderFilesTab(bodyEl); break;
		}
	}

	private _renderAboutTab(body: HTMLElement): void {
		const ch = this.channelInfo;
		if (!ch) { return; }

		const section = (label: string): HTMLElement => {
			const lbl = DOM.append(body, DOM.$('div'));
			lbl.textContent = label;
			lbl.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);margin-bottom:6px;';
			return lbl;
		};
		const card = (icon: string, text: string, onClick?: () => void): void => {
			const row = DOM.append(body, DOM.$('div'));
			row.style.cssText = `display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--vscode-editorWidget-border);border-radius:6px;font-size:13px;margin-bottom:10px;${onClick ? 'cursor:pointer;' : ''}`;
			const ic = DOM.append(row, DOM.$('span'));
			ic.textContent = icon;
			ic.style.cssText = 'font-size:14px;';
			const tx = DOM.append(row, DOM.$('span'));
			tx.textContent = text;
			if (onClick) {
				row.addEventListener('click', onClick);
				row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
				row.addEventListener('mouseleave', () => { row.style.background = ''; });
			}
		};

		if (ch.topic) {
			section('TOPIC');
			const topic = DOM.append(body, DOM.$('div'));
			topic.textContent = ch.topic;
			topic.style.cssText = 'font-size:13px;margin-bottom:16px;';
		}
		if (ch.description) {
			section('DESCRIPTION');
			const desc = DOM.append(body, DOM.$('div'));
			desc.textContent = ch.description;
			desc.style.cssText = 'font-size:13px;margin-bottom:16px;';
		}

		section('CREATED');
		const created = DOM.append(body, DOM.$('div'));
		created.textContent = ch.createdAt ? new Date(ch.createdAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : 'Unknown';
		created.style.cssText = 'font-size:13px;margin-bottom:16px;';

		const count = ch.memberCount ?? ch.members?.length ?? 0;
		// allow-any-unicode-next-line
		card('👥', `${count} member${count === 1 ? '' : 's'}`, () => { this.detailsTab = 'members'; this._renderDetails(); });

		const typeLabel = ch.type === 'private' ? 'Private Channel'
			: ch.type === 'dm' ? 'Direct Message'
				: ch.type === 'group_dm' ? 'Group Message'
					: 'Public Channel';
		// allow-any-unicode-next-line
		card(ch.type === 'private' ? '🔒' : ch.type === 'dm' || ch.type === 'group_dm' ? '👤' : '#', typeLabel);
	}

	private _renderMembersTab(body: HTMLElement): void {
		const ch = this.channelInfo;
		const members = ch?.members ?? [];

		// ---- Add-people search (staff + patients), mirroring the Create Channel
		// modal's people-picker. DMs have a fixed pair of participants, so adding
		// members only applies to channels. ----
		if (ch && ch.type !== 'dm') {
			const addBox = DOM.append(body, DOM.$('div'));
			addBox.style.cssText = 'margin-bottom:14px;';
			const input = DOM.append(addBox, DOM.$('input')) as HTMLInputElement;
			input.type = 'text';
			input.placeholder = 'Add people…';
			input.style.cssText = 'width:100%;padding:8px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
			input.addEventListener('focus', () => { input.style.borderColor = 'var(--vscode-focusBorder)'; });
			input.addEventListener('blur', () => { input.style.borderColor = 'var(--vscode-input-border,#3c3c3c)'; });

			const results = DOM.append(addBox, DOM.$('div'));
			results.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:6px;margin-top:4px;max-height:180px;overflow:auto;display:none;';

			const existingIds = new Set(members.map(m => m.userId));
			let timer: number | undefined;
			let seq = 0;
			input.addEventListener('input', () => {
				const q = input.value.trim();
				if (timer) { mainWindow.clearTimeout(timer); }
				if (q.length < 2) { results.style.display = 'none'; return; }
				timer = mainWindow.setTimeout(async () => {
					const mySeq = ++seq;
					const matches = (await this._searchPeople(q)).filter(c => !existingIds.has(c.id));
					if (mySeq !== seq) { return; } // superseded by a newer search
					DOM.clearNode(results);
					if (matches.length === 0) { results.style.display = 'none'; return; }
					results.style.display = 'block';
					for (const c of matches) {
						const opt = DOM.append(results, DOM.$('div'));
						opt.style.cssText = 'padding:8px 10px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:8px;';
						const label = DOM.append(opt, DOM.$('span'));
						label.textContent = c.detail ? `${c.name} — ${c.detail}` : c.name;
						label.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
						const tag = DOM.append(opt, DOM.$('span'));
						tag.textContent = c.tag;
						tag.style.cssText = `flex-shrink:0;font-size:10px;font-weight:600;padding:1px 6px;border-radius:10px;background:${c.tag === 'Patient' ? 'rgba(52,168,83,0.18)' : 'var(--vscode-badge-background)'};color:${c.tag === 'Patient' ? '#34a853' : 'var(--vscode-badge-foreground)'};`;
						opt.addEventListener('mouseenter', () => { opt.style.background = 'var(--vscode-list-hoverBackground)'; });
						opt.addEventListener('mouseleave', () => { opt.style.background = ''; });
						opt.addEventListener('click', () => { void this._addMemberToChannel(c); });
					}
				}, 250);
			});
		}

		if (members.length === 0) {
			this._renderEmpty(body, 'No members to show.');
			return;
		}
		for (const m of members) {
			const row = DOM.append(body, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;';
			const av = DOM.append(row, DOM.$('div'));
			av.textContent = m.avatar?.initials || this._initials(m.displayName);
			av.style.cssText = 'width:32px;height:32px;border-radius:50%;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;';
			const info = DOM.append(row, DOM.$('div'));
			info.style.cssText = 'min-width:0;flex:1;';
			const nm = DOM.append(info, DOM.$('div'));
			nm.textContent = m.displayName;
			nm.style.cssText = 'font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			if (m.role) {
				const role = DOM.append(info, DOM.$('div'));
				role.textContent = m.role === 'owner' ? 'Owner' : m.role.charAt(0).toUpperCase() + m.role.slice(1);
				role.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
			}
			// Remove control — not offered for the channel owner or in DMs.
			if (ch && ch.type !== 'dm' && m.role !== 'owner') {
				const remove = DOM.append(row, DOM.$('span')) as HTMLElement;
				// allow-any-unicode-next-line
				remove.textContent = '✕';
				remove.title = `Remove ${m.displayName}`;
				remove.style.cssText = 'cursor:pointer;font-size:12px;color:var(--vscode-descriptionForeground);padding:2px 6px;border-radius:4px;flex-shrink:0;';
				remove.addEventListener('mouseenter', () => { remove.style.background = 'var(--vscode-list-hoverBackground)'; remove.style.color = 'var(--vscode-errorForeground)'; });
				remove.addEventListener('mouseleave', () => { remove.style.background = ''; remove.style.color = 'var(--vscode-descriptionForeground)'; });
				remove.addEventListener('click', () => { void this._removeMemberFromChannel(m); });
			}
		}
	}

	/** Search staff users and patients for the add-people picker. Mirrors the
	 *  Create Channel modal: staff via /api/admin/users, patients via /api/patients
	 *  (keyed by fhirId so they match the create-flow member ids). */
	private async _searchPeople(q: string): Promise<MemberSearchResult[]> {
		const staff = async (): Promise<MemberSearchResult[]> => {
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
		const patients = async (): Promise<MemberSearchResult[]> => {
			try {
				const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
				if (!res.ok) { return []; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<{ id?: string; fhirId?: string; firstName?: string; lastName?: string; dateOfBirth?: string }>;
				return list.map(p => {
					const id = p.fhirId || p.id || '';
					return { id, name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || id, detail: p.dateOfBirth || '', tag: 'Patient' as const };
				}).filter(c => c.id);
			} catch { return []; }
		};
		const [s, p] = await Promise.all([staff(), patients()]);
		return [...s, ...p];
	}

	/** Add a staff member or patient to the current channel, then refresh. */
	private async _addMemberToChannel(person: MemberSearchResult): Promise<void> {
		const channelId = this.channelInfo?.id;
		if (!channelId) { return; }
		try {
			const res = await this.apiService.fetch(`/api/channels/${channelId}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: person.id, displayName: person.name }),
			});
			if (!res.ok) { return; }
			// Optimistically reflect the new member, then re-fetch authoritative data.
			if (this.channelInfo) {
				const members = this.channelInfo.members ?? [];
				if (!members.some(m => m.userId === person.id)) {
					this.channelInfo.members = [...members, { userId: person.id, displayName: person.name, role: 'member' }];
					this.channelInfo.memberCount = (this.channelInfo.memberCount ?? members.length) + 1;
				}
			}
			this._renderDetails();
			await this._loadChannelDetails(channelId);
		} catch { /* add failed */ }
	}

	/** Remove a member from the current channel, then refresh. */
	private async _removeMemberFromChannel(member: ChannelMember): Promise<void> {
		const channelId = this.channelInfo?.id;
		if (!channelId) { return; }
		try {
			const res = await this.apiService.fetch(`/api/channels/${channelId}/members/${encodeURIComponent(member.userId)}`, { method: 'DELETE' });
			if (!res.ok) { return; }
			if (this.channelInfo) {
				const members = (this.channelInfo.members ?? []).filter(m => m.userId !== member.userId);
				this.channelInfo.members = members;
				this.channelInfo.memberCount = members.length;
			}
			this._renderDetails();
			await this._loadChannelDetails(channelId);
		} catch { /* remove failed */ }
	}

	private async _renderPinnedTab(body: HTMLElement): Promise<void> {
		const channelId = this.channelInfo?.id;
		if (!channelId) { return; }
		const loading = DOM.append(body, DOM.$('div'));
		loading.textContent = 'Loading…';
		loading.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
		let pinned: Message[] = [];
		try {
			const res = await this.apiService.fetch(`/api/channels/${channelId}/pinned`);
			if (res.ok) {
				const data = await res.json();
				pinned = data?.data || data?.content || data || [];
				if (!Array.isArray(pinned)) { pinned = []; }
			}
		} catch { /* ignore */ }
		// Bail if the user navigated away from the Pinned tab while loading.
		if (this.detailsTab !== 'pinned') { return; }
		DOM.clearNode(body);
		if (pinned.length === 0) {
			// allow-any-unicode-next-line
			this._renderEmpty(body, '📌 No pinned messages yet.');
			return;
		}
		for (const msg of pinned) {
			const row = DOM.append(body, DOM.$('div'));
			row.style.cssText = 'padding:10px 0;border-bottom:1px solid var(--vscode-editorWidget-border);';
			const author = DOM.append(row, DOM.$('div'));
			author.textContent = msg.senderName || 'Unknown';
			author.style.cssText = 'font-size:12px;font-weight:600;margin-bottom:2px;';
			const content = DOM.append(row, DOM.$('div'));
			content.style.cssText = 'font-size:13px;color:var(--vscode-foreground);word-break:break-word;';
			this._renderRichContent(content, msg.content);
		}
	}

	private _renderFilesTab(body: HTMLElement): void {
		// Files are not a dedicated endpoint — aggregate attachments from the loaded
		// messages (most recent first).
		const files: Array<{ fileName: string; fileSize: number; fileType: string }> = [];
		for (let i = this.messages.length - 1; i >= 0; i--) {
			for (const a of this.messages[i].attachments ?? []) { files.push(a); }
		}
		if (files.length === 0) {
			// allow-any-unicode-next-line
			this._renderEmpty(body, '📎 No files shared yet.');
			return;
		}
		for (const f of files) {
			const row = DOM.append(body, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;';
			const ic = DOM.append(row, DOM.$('span'));
			// allow-any-unicode-next-line
			ic.textContent = f.fileType?.startsWith('image/') ? '🖼️' : f.fileType?.includes('pdf') ? '📄' : '📎';
			ic.style.cssText = 'font-size:18px;flex-shrink:0;';
			const info = DOM.append(row, DOM.$('div'));
			info.style.cssText = 'min-width:0;flex:1;';
			const nm = DOM.append(info, DOM.$('div'));
			nm.textContent = f.fileName;
			nm.style.cssText = 'font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			const sz = DOM.append(info, DOM.$('div'));
			sz.textContent = `${(f.fileSize / 1024 / 1024).toFixed(2)} MB`;
			sz.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';
		}
	}

	private _renderEmpty(body: HTMLElement, text: string): void {
		const empty = DOM.append(body, DOM.$('div'));
		empty.textContent = text;
		empty.style.cssText = 'padding:24px 0;text-align:center;font-size:12px;color:var(--vscode-descriptionForeground);';
	}

	private _initials(name: string): string {
		return name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
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
		for (const url of this.pendingPreviewUrls) { URL.revokeObjectURL(url); }
		this.pendingPreviewUrls = [];
		for (const url of this.attachmentObjectUrls) { URL.revokeObjectURL(url); }
		this.attachmentObjectUrls = [];
		super.dispose();
	}
}
