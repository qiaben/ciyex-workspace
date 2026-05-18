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
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { TelehealthEditorInput } from './ciyexEditorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';

/**
 * Generic session data returned by /api/telehealth/sessions/{id}.
 * Mirrors VideoCallSession in ciyex-ehr-ui — populated by whichever vendor
 * adapter the backend SDK routed to (mediasoup, Twilio, Zoom, Doxy, iframe).
 */
interface TelehealthSession {
	id: string;
	roomName?: string;
	status?: string;
	patientId?: string;
	patientName?: string;
	providerName?: string;
	providerType?: string; // "mediasoup" | "iframe" | "zoom" | "doxy" | ...
	joinInfo?: {
		joinUrl?: string;
		wsUrl?: string;
		token?: string;
		roomName?: string;
		[key: string]: string | undefined;
	};
}

type CallStatus = 'connecting' | 'connected' | 'ended' | 'error';
type RecordingStatus = 'idle' | 'starting' | 'recording' | 'stopping';

/**
 * Telehealth video visit editor.
 * Mirrors the ciyex-ehr-ui flow at /telehealth/[appointmentId] + /telehealth/session/[sessionId]:
 *   1. POST /api/telehealth/sessions/from-appointment       → create session
 *   2. POST /api/telehealth/sessions/{id}/start             → start (provider role)
 *   3. GET  /api/telehealth/sessions/{id}                   → fetch joinInfo
 *   4. Render either iframe embed (joinUrl) or WebRTC view with local preview
 *      For mediasoup/wsUrl-based providers, full media is handled by the
 *      configured EHR UI's session page (loaded in an iframe) so we don't
 *      duplicate the mediasoup-client logic in the workbench.
 *   5. POST /api/telehealth/sessions/{id}/recording/{start,stop}
 *   6. POST /api/telehealth/sessions/{id}/end               → end (provider role)
 */
const KEYFRAMES_INJECTED = new WeakSet<Document>();

export class TelehealthEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexTelehealth';

	private static _ensureSpinKeyframes(): void {
		const doc = mainWindow.document;
		if (KEYFRAMES_INJECTED.has(doc)) { return; }
		const style = DOM.append(doc.head, DOM.$('style')) as HTMLStyleElement;
		style.textContent = '@keyframes ciyex-tele-spin{to{transform:rotate(360deg);}}';
		KEYFRAMES_INJECTED.add(doc);
	}

	private root!: HTMLElement;
	private headerEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private controlsEl!: HTMLElement;

	private appointmentId = '';
	private session: TelehealthSession | null = null;
	private callStatus: CallStatus = 'connecting';
	private videoEnabled = true;
	private audioEnabled = true;
	private recordingStatus: RecordingStatus = 'idle';
	private recordingError = '';
	private sessionError = '';
	private chatOpen = false;
	private chatMessages: Array<{ senderName: string; content: string; sentAt: string }> = [];
	private chatInput = '';

	private localStream: MediaStream | null = null;
	private localVideoEl: HTMLVideoElement | null = null;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(TelehealthEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-telehealth-root'));
		this.root.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#0f1115;color:#e5e7eb;';

		this.headerEl = DOM.append(this.root, DOM.$('.tele-header'));
		this.headerEl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#1f2937;border-bottom:1px solid #374151;';

		this.bodyEl = DOM.append(this.root, DOM.$('.tele-body'));
		this.bodyEl.style.cssText = 'flex:1;position:relative;display:flex;background:#030712;min-height:0;overflow:hidden;';

		this.controlsEl = DOM.append(this.root, DOM.$('.tele-controls'));
		this.controlsEl.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:12px;padding:14px;background:#1f2937;border-top:1px solid #374151;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof TelehealthEditorInput)) { return; }
		this.appointmentId = input.appointmentId;
		this.callStatus = 'connecting';
		this.sessionError = '';
		this.session = null;
		this._render();
		await this._initSession();
	}

	override clearInput(): void {
		this._teardownLocalStream();
		super.clearInput();
	}

	override dispose(): void {
		this._teardownLocalStream();
		super.dispose();
	}

	private async _initSession(): Promise<void> {
		try {
			// Step 1: create-or-get session from appointment
			const createRes = await this.apiService.fetch('/api/telehealth/sessions/from-appointment', {
				method: 'POST',
				body: JSON.stringify({ appointmentId: String(this.appointmentId) }),
			});
			if (!createRes.ok) {
				const text = await createRes.text();
				throw new Error(text || `Failed to create session (HTTP ${createRes.status})`);
			}
			const createJson = await createRes.json();
			let session: TelehealthSession = createJson.data || createJson;
			if (!session?.id) { throw new Error('No session ID returned'); }

			// Step 2: start session (provider role) if not already in progress
			if (session.status !== 'IN_PROGRESS') {
				try {
					const startRes = await this.apiService.fetch(`/api/telehealth/sessions/${session.id}/start`, { method: 'POST' });
					if (startRes.ok) {
						const startJson = await startRes.json();
						session = startJson.data || startJson || session;
					}
				} catch { /* keep created session */ }
			}

			this.session = session;

			// Step 3: get local camera preview for WebRTC-based providers.
			// Iframe-based vendors handle media inside the iframe themselves.
			if (!this.session.joinInfo?.joinUrl) {
				await this._startLocalPreview();
			}

			this.callStatus = 'connected';
			this._render();
		} catch (err) {
			this.sessionError = err instanceof Error ? err.message : 'Failed to load telehealth session';
			this.callStatus = 'error';
			this._render();
		}
	}

	private async _startLocalPreview(): Promise<void> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
			this.localStream = stream;
			if (this.localVideoEl) {
				this.localVideoEl.srcObject = stream;
			}
		} catch (err) {
			this.notificationService.notify({
				severity: Severity.Warning,
				message: `Could not access camera/microphone: ${err instanceof Error ? err.message : 'unknown error'}`,
			});
		}
	}

	private _teardownLocalStream(): void {
		if (this.localStream) {
			for (const track of this.localStream.getTracks()) { track.stop(); }
			this.localStream = null;
		}
		if (this.localVideoEl) { this.localVideoEl.srcObject = null; }
	}

	private async _toggleVideo(): Promise<void> {
		this.videoEnabled = !this.videoEnabled;
		if (this.localStream) {
			for (const track of this.localStream.getVideoTracks()) { track.enabled = this.videoEnabled; }
		}
		this._render();
	}

	private async _toggleAudio(): Promise<void> {
		this.audioEnabled = !this.audioEnabled;
		if (this.localStream) {
			for (const track of this.localStream.getAudioTracks()) { track.enabled = this.audioEnabled; }
		}
		this._render();
	}

	private async _toggleRecording(): Promise<void> {
		if (!this.session?.id) { return; }
		this.recordingError = '';
		try {
			if (this.recordingStatus === 'idle') {
				this.recordingStatus = 'starting';
				this._render();
				const res = await this.apiService.fetch(`/api/telehealth/sessions/${this.session.id}/recording/start`, {
					method: 'POST',
					body: JSON.stringify({ mode: 'COMPOSITE' }),
				});
				if (!res.ok) { throw new Error(await res.text() || 'Failed to start recording'); }
				this.recordingStatus = 'recording';
			} else if (this.recordingStatus === 'recording') {
				this.recordingStatus = 'stopping';
				this._render();
				const res = await this.apiService.fetch(`/api/telehealth/sessions/${this.session.id}/recording/stop`, { method: 'POST' });
				if (!res.ok) { throw new Error(await res.text() || 'Failed to stop recording'); }
				this.recordingStatus = 'idle';
			}
		} catch (err) {
			this.recordingError = err instanceof Error ? err.message : 'Recording failed';
			this.recordingStatus = 'idle';
		}
		this._render();
	}

	private async _endCall(): Promise<void> {
		const sessionId = this.session?.id;
		this._teardownLocalStream();
		this.callStatus = 'ended';
		this._render();
		if (sessionId) {
			try {
				await this.apiService.fetch(`/api/telehealth/sessions/${sessionId}/end`, { method: 'POST' });
			} catch { /* */ }
		}
	}

	private _sendChat(): void {
		const text = this.chatInput.trim();
		if (!text) { return; }
		this.chatMessages.push({ senderName: 'Provider', content: text, sentAt: new Date().toISOString() });
		this.chatInput = '';
		this._render();
	}

	// allow-any-unicode-next-line
	// ─── Render ──────────────────────────────────────────────────────────────

	private _render(): void {
		this._renderHeader();
		this._renderBody();
		this._renderControls();
	}

	private _renderHeader(): void {
		DOM.clearNode(this.headerEl);

		const left = DOM.append(this.headerEl, DOM.$('div'));
		left.style.cssText = 'display:flex;align-items:center;gap:10px;';
		const icon = DOM.append(left, DOM.$('span'));
		icon.textContent = '\u{1F4F9}';
		icon.style.cssText = 'font-size:18px;color:#22c55e;';
		const titleWrap = DOM.append(left, DOM.$('div'));
		const title = DOM.append(titleWrap, DOM.$('div'));
		title.textContent = 'Telehealth Session';
		title.style.cssText = 'font-size:14px;font-weight:600;color:#fff;';
		const sub = DOM.append(titleWrap, DOM.$('div'));
		const peerName = this.session?.patientName || (this.input as TelehealthEditorInput | undefined)?.patientName || 'Patient';
		const statusLabel = this.callStatus === 'connected' ? 'Connected' : this.callStatus === 'connecting' ? 'Connecting...' : this.callStatus === 'ended' ? 'Call ended' : 'Error';
		sub.textContent = `${peerName} • ${statusLabel}`;
		sub.style.cssText = 'font-size:11px;color:#9ca3af;margin-top:2px;';

		const right = DOM.append(this.headerEl, DOM.$('div'));
		right.style.cssText = 'display:flex;align-items:center;gap:8px;';

		if (this.recordingStatus === 'recording') {
			const rec = DOM.append(right, DOM.$('span'));
			rec.textContent = '● Recording';
			rec.style.cssText = 'font-size:11px;color:#fca5a5;background:rgba(127,29,29,0.3);padding:3px 8px;border-radius:4px;';
		}
		if (this.recordingError) {
			const err = DOM.append(right, DOM.$('span'));
			err.textContent = `⚠ ${this.recordingError}`;
			err.style.cssText = 'font-size:11px;color:#fca5a5;background:rgba(127,29,29,0.3);padding:3px 8px;border-radius:4px;';
		}
		if (this.session?.providerType) {
			const vendor = DOM.append(right, DOM.$('span'));
			vendor.textContent = this.session.providerType;
			vendor.style.cssText = 'font-size:10px;color:#9ca3af;background:#374151;padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;';
		}
	}

	private _renderBody(): void {
		DOM.clearNode(this.bodyEl);
		this.localVideoEl = null;

		// Loading state
		if (this.callStatus === 'connecting' && !this.session) {
			this._renderCentered(this.bodyEl, 'Joining telehealth session...', 'Please allow camera and microphone access when prompted', true);
			return;
		}
		// Error state
		if (this.callStatus === 'error' || this.sessionError) {
			this._renderCentered(this.bodyEl, 'Unable to Join', this.sessionError || 'Failed to connect to session', false, '#ef4444');
			return;
		}
		// Ended state
		if (this.callStatus === 'ended') {
			this._renderCentered(this.bodyEl, 'Call Ended', 'The telehealth session has ended.', false, '#ef4444');
			return;
		}

		const join = this.session?.joinInfo || {};

		// Iframe-based vendor (Zoom, Doxy, etc.) — embed joinUrl directly
		if (join.joinUrl) {
			const frame = DOM.append(this.bodyEl, DOM.$('iframe')) as HTMLIFrameElement;
			frame.src = join.joinUrl;
			frame.allow = 'camera; microphone; display-capture; fullscreen; autoplay';
			frame.style.cssText = 'flex:1;border:0;width:100%;height:100%;background:#000;';
			frame.title = 'Telehealth Video Call';
			return;
		}

		// WebRTC-based vendor (mediasoup, Twilio Video, etc.)
		// Workbench shows a local preview + waiting indicator. For mediasoup/wsUrl,
		// the EHR UI session page handles the full peer connection (configured via
		// the workspace's 'ciyex.telehealth.provider' setting + portal URL).
		const stage = DOM.append(this.bodyEl, DOM.$('.stage'));
		stage.style.cssText = 'flex:1;position:relative;background:#030712;display:flex;align-items:center;justify-content:center;';

		const waiting = DOM.append(stage, DOM.$('.waiting'));
		waiting.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;color:#6b7280;';
		const wIcon = DOM.append(waiting, DOM.$('div'));
		wIcon.textContent = '\u{1F465}';
		wIcon.style.cssText = 'font-size:48px;opacity:0.5;';
		const wText = DOM.append(waiting, DOM.$('div'));
		wText.textContent = 'Waiting for patient to join...';
		wText.style.cssText = 'font-size:14px;color:#9ca3af;';
		if (join.wsUrl) {
			const hint = DOM.append(waiting, DOM.$('div'));
			hint.textContent = `Signaling: ${join.wsUrl}`;
			hint.style.cssText = 'font-size:10px;color:#4b5563;margin-top:6px;';
		}

		// Local preview (PiP)
		const pip = DOM.append(stage, DOM.$('.pip'));
		pip.style.cssText = 'position:absolute;bottom:16px;right:16px;width:200px;height:140px;background:#111827;border:2px solid #374151;border-radius:8px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
		this.localVideoEl = DOM.append(pip, DOM.$('video')) as HTMLVideoElement;
		this.localVideoEl.autoplay = true;
		this.localVideoEl.playsInline = true;
		this.localVideoEl.muted = true;
		this.localVideoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1);';
		if (this.localStream) {
			this.localVideoEl.srcObject = this.localStream;
		}
		if (!this.videoEnabled) {
			const off = DOM.append(pip, DOM.$('.video-off'));
			off.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#1f2937;font-size:24px;color:#9ca3af;';
			off.textContent = '\u{1F4F7}\u{20E0}';
		}

		// Chat panel
		if (this.chatOpen) {
			const chatPanel = DOM.append(this.bodyEl, DOM.$('.chat'));
			chatPanel.style.cssText = 'width:320px;border-left:1px solid #374151;background:#111827;display:flex;flex-direction:column;';
			const chatHead = DOM.append(chatPanel, DOM.$('div'));
			chatHead.style.cssText = 'padding:10px 12px;border-bottom:1px solid #374151;display:flex;justify-content:space-between;align-items:center;';
			const chatTitle = DOM.append(chatHead, DOM.$('span'));
			chatTitle.textContent = 'Chat';
			chatTitle.style.cssText = 'font-size:13px;font-weight:600;color:#fff;';
			const closeBtn = DOM.append(chatHead, DOM.$('button')) as HTMLButtonElement;
			closeBtn.textContent = 'Close';
			closeBtn.style.cssText = 'background:transparent;border:0;color:#9ca3af;cursor:pointer;font-size:11px;';
			closeBtn.addEventListener('click', () => { this.chatOpen = false; this._render(); });

			const chatList = DOM.append(chatPanel, DOM.$('.chat-list'));
			chatList.style.cssText = 'flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;';
			for (const msg of this.chatMessages) {
				const row = DOM.append(chatList, DOM.$('div'));
				const meta = DOM.append(row, DOM.$('div'));
				meta.textContent = `${msg.senderName} • ${new Date(msg.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
				meta.style.cssText = 'font-size:10px;color:#6b7280;margin-bottom:2px;';
				const bubble = DOM.append(row, DOM.$('div'));
				bubble.textContent = msg.content;
				bubble.style.cssText = 'background:#22c55e;color:#fff;padding:6px 10px;border-radius:8px;font-size:12px;display:inline-block;max-width:100%;word-break:break-word;';
			}

			const chatForm = DOM.append(chatPanel, DOM.$('div'));
			chatForm.style.cssText = 'padding:8px;border-top:1px solid #374151;display:flex;gap:6px;';
			const chatField = DOM.append(chatForm, DOM.$('input')) as HTMLInputElement;
			chatField.type = 'text';
			chatField.placeholder = 'Type a message...';
			chatField.value = this.chatInput;
			chatField.style.cssText = 'flex:1;background:#1f2937;border:1px solid #374151;border-radius:4px;padding:6px 8px;color:#e5e7eb;font-size:12px;outline:none;';
			chatField.addEventListener('input', () => { this.chatInput = chatField.value; });
			chatField.addEventListener('keydown', ev => { if (ev.key === 'Enter') { this._sendChat(); } });
			const sendBtn = DOM.append(chatForm, DOM.$('button')) as HTMLButtonElement;
			sendBtn.textContent = 'Send';
			sendBtn.style.cssText = 'background:#22c55e;color:#fff;border:0;border-radius:4px;padding:6px 10px;font-size:12px;cursor:pointer;';
			sendBtn.addEventListener('click', () => this._sendChat());
		}
	}

	private _renderCentered(host: HTMLElement, title: string, subtitle: string, spin: boolean, accent: string = '#22c55e'): void {
		const wrap = DOM.append(host, DOM.$('div'));
		wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;padding:24px;';
		if (spin) {
			const sp = DOM.append(wrap, DOM.$('div'));
			sp.style.cssText = `width:36px;height:36px;border:3px solid ${accent};border-top-color:transparent;border-radius:50%;animation:ciyex-tele-spin 1s linear infinite;`;
			TelehealthEditor._ensureSpinKeyframes();
		}
		const h = DOM.append(wrap, DOM.$('div'));
		h.textContent = title;
		h.style.cssText = `font-size:18px;font-weight:600;color:${accent};`;
		const p = DOM.append(wrap, DOM.$('div'));
		p.textContent = subtitle;
		p.style.cssText = 'font-size:12px;color:#9ca3af;max-width:480px;line-height:1.5;';
	}

	private _renderControls(): void {
		DOM.clearNode(this.controlsEl);

		if (this.callStatus === 'ended' || this.callStatus === 'error') {
			const close = DOM.append(this.controlsEl, DOM.$('button')) as HTMLButtonElement;
			close.textContent = 'Close';
			close.style.cssText = 'padding:8px 24px;background:#374151;color:#fff;border:0;border-radius:24px;font-size:13px;cursor:pointer;';
			close.addEventListener('click', () => {
				const cur = this.input;
				if (cur) { this.group.closeEditor(cur); }
			});
			return;
		}

		const iconBtn = (label: string, glyph: string, bg: string, onClick: () => void, disabled = false) => {
			const b = DOM.append(this.controlsEl, DOM.$('button')) as HTMLButtonElement;
			b.title = label;
			b.textContent = glyph;
			b.disabled = disabled;
			b.style.cssText = `width:44px;height:44px;border-radius:50%;border:0;background:${bg};color:#fff;font-size:18px;cursor:${disabled ? 'not-allowed' : 'pointer'};display:flex;align-items:center;justify-content:center;opacity:${disabled ? '0.5' : '1'};`;
			b.addEventListener('click', onClick);
			return b;
		};

		iconBtn(this.audioEnabled ? 'Mute' : 'Unmute', this.audioEnabled ? '\u{1F3A4}' : '\u{1F507}', this.audioEnabled ? '#3b82f6' : '#ef4444', () => this._toggleAudio());
		iconBtn(this.videoEnabled ? 'Turn off camera' : 'Turn on camera', this.videoEnabled ? '\u{1F4F9}' : '\u{1F4F7}', this.videoEnabled ? '#3b82f6' : '#ef4444', () => this._toggleVideo());
		iconBtn('Chat', '\u{1F4AC}', this.chatOpen ? '#22c55e' : '#374151', () => { this.chatOpen = !this.chatOpen; this._render(); });
		const isRecording = this.recordingStatus === 'recording';
		const isToggling = this.recordingStatus === 'starting' || this.recordingStatus === 'stopping';
		iconBtn(isRecording ? 'Stop recording' : 'Start recording', isRecording ? '\u{23F9}' : '\u{25CF}', isRecording ? '#ef4444' : '#374151', () => this._toggleRecording(), isToggling);

		const end = DOM.append(this.controlsEl, DOM.$('button')) as HTMLButtonElement;
		end.textContent = '\u{1F4F4}  End Call';
		end.style.cssText = 'margin-left:12px;padding:10px 18px;background:#ef4444;color:#fff;border:0;border-radius:24px;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:6px;';
		end.addEventListener('click', () => this._endCall());
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
