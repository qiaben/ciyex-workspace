/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Argument the workbench (or any caller) passes when invoking
 * `ciyex-telehealth.openSession`. The auth token + api url are forwarded
 * explicitly so this extension never depends on workbench-internal services
 * — only the public vscode extension API + plain HTTP.
 */
interface OpenSessionRequest {
	appointmentId: string;
	patientName?: string;
	providerName?: string;
	/** Bearer token for the Ciyex API. Forwarded from the workbench's auth service. */
	authToken: string;
	/** Tenant header value (org_alias). */
	orgAlias?: string;
	/** Override for the API base URL. If absent, falls back to the extension setting. */
	apiUrl?: string;
}

const OPEN_COMMAND = 'ciyex-telehealth.openSession';
const CONFIGURE_COMMAND = 'ciyex-telehealth.configure';

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(OPEN_COMMAND, async (request: OpenSessionRequest | undefined) => {
			if (!request || !request.appointmentId) {
				vscode.window.showWarningMessage('Telehealth: missing appointment id.');
				return;
			}
			openSessionPanel(context, request);
		}),
		vscode.commands.registerCommand(CONFIGURE_COMMAND, () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'ciyex.telehealth');
		}),
	);
}

export function deactivate(): void { /* no-op */ }

function openSessionPanel(context: vscode.ExtensionContext, request: OpenSessionRequest): void {
	const cfg = vscode.workspace.getConfiguration('ciyex.telehealth');
	const apiUrl = (request.apiUrl || cfg.get<string>('apiUrl') || '').trim();
	const recordingMode = cfg.get<'COMPOSITE' | 'INDIVIDUAL'>('recordingMode') ?? 'COMPOSITE';

	if (!apiUrl) {
		vscode.window.showErrorMessage('Telehealth: no API URL configured. Set ciyex.telehealth.apiUrl or pass apiUrl in the open request.');
		return;
	}
	if (!request.authToken) {
		vscode.window.showErrorMessage('Telehealth: missing auth token. The workbench must forward the user\'s bearer token when opening a session.');
		return;
	}

	const title = request.patientName
		? `Telehealth: ${request.patientName}`
		: `Telehealth: appointment ${request.appointmentId}`;

	const panel = vscode.window.createWebviewPanel(
		'ciyexTelehealthSession',
		title,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		},
	);

	panel.webview.html = renderSessionHtml({
		appointmentId: request.appointmentId,
		patientName: request.patientName || 'Patient',
		providerName: request.providerName || 'Provider',
		apiUrl: apiUrl.replace(/\/$/, ''),
		authToken: request.authToken,
		orgAlias: request.orgAlias || '',
		recordingMode,
	});

	// Surface webview-side errors/notifications back through native UI so the
	// user sees them even when the panel is in the background.
	const sub = panel.webview.onDidReceiveMessage((msg: { type: string; message?: string; severity?: 'info' | 'warning' | 'error' }) => {
		if (msg.type === 'notify' && msg.message) {
			const sev = msg.severity ?? 'info';
			if (sev === 'error') {
				vscode.window.showErrorMessage(msg.message);
			} else if (sev === 'warning') {
				vscode.window.showWarningMessage(msg.message);
			} else {
				vscode.window.showInformationMessage(msg.message);
			}
		} else if (msg.type === 'endCall') {
			panel.dispose();
		}
	});
	panel.onDidDispose(() => sub.dispose());
}

interface RenderOptions {
	appointmentId: string;
	patientName: string;
	providerName: string;
	apiUrl: string;
	authToken: string;
	orgAlias: string;
	recordingMode: 'COMPOSITE' | 'INDIVIDUAL';
}

/**
 * Render the telehealth webview. All session orchestration (create / start /
 * status / record / end) happens inside the page — this keeps the extension
 * tiny and lets us iterate on UI without rebuilding the host.
 */
function renderSessionHtml(opts: RenderOptions): string {
	const csp = [
		`default-src 'none'`,
		`img-src https: data: blob:`,
		`style-src 'unsafe-inline'`,
		`script-src 'unsafe-inline'`,
		// Webview cannot reach localhost-only services; we trust the configured
		// API host + WebSocket signaling + arbitrary HTTPS for iframe vendors.
		`connect-src ${opts.apiUrl} wss: https:`,
		`frame-src https:`,
		`media-src 'self' blob: mediastream:`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Telehealth Session</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
	margin: 0;
	background: #0f1115;
	color: #e5e7eb;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	font-size: 13px;
	height: 100vh;
	overflow: hidden;
}
.root { display: flex; flex-direction: column; height: 100%; }
.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 10px 16px;
	background: #1f2937;
	border-bottom: 1px solid #374151;
}
.h-left { display: flex; align-items: center; gap: 10px; }
.h-icon { font-size: 18px; color: #22c55e; }
.h-title { font-size: 14px; font-weight: 600; color: #fff; }
.h-sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
.h-right { display: flex; align-items: center; gap: 8px; }
.badge {
	font-size: 10px;
	padding: 3px 8px;
	border-radius: 4px;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}
.badge-vendor { color: #9ca3af; background: #374151; }
.badge-rec { color: #fca5a5; background: rgba(127, 29, 29, 0.3); }
.body {
	flex: 1;
	position: relative;
	display: flex;
	background: #030712;
	min-height: 0;
	overflow: hidden;
}
.stage { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; }
.waiting { display: flex; flex-direction: column; align-items: center; gap: 8px; color: #6b7280; }
.w-icon { font-size: 48px; opacity: 0.5; }
.w-text { font-size: 14px; color: #9ca3af; }
.w-hint { font-size: 10px; color: #4b5563; margin-top: 6px; }
.pip {
	position: absolute;
	bottom: 16px;
	right: 16px;
	width: 200px;
	height: 140px;
	background: #111827;
	border: 2px solid #374151;
	border-radius: 8px;
	overflow: hidden;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.pip video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); }
.video-off {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: #1f2937;
	font-size: 24px;
	color: #9ca3af;
}
iframe.vendor { flex: 1; border: 0; width: 100%; height: 100%; background: #000; }
.centered {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	text-align: center;
	padding: 24px;
}
.spin {
	width: 36px;
	height: 36px;
	border: 3px solid #22c55e;
	border-top-color: transparent;
	border-radius: 50%;
	animation: spin 1s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.c-title { font-size: 18px; font-weight: 600; color: #22c55e; }
.c-title.err { color: #ef4444; }
.c-sub { font-size: 12px; color: #9ca3af; max-width: 480px; line-height: 1.5; }
.chat {
	width: 320px;
	border-left: 1px solid #374151;
	background: #111827;
	display: flex;
	flex-direction: column;
}
.chat-head {
	padding: 10px 12px;
	border-bottom: 1px solid #374151;
	display: flex;
	justify-content: space-between;
	align-items: center;
}
.chat-title { font-size: 13px; font-weight: 600; color: #fff; }
.chat-close { background: transparent; border: 0; color: #9ca3af; cursor: pointer; font-size: 11px; }
.chat-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.chat-meta { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
.chat-bubble {
	background: #22c55e;
	color: #fff;
	padding: 6px 10px;
	border-radius: 8px;
	font-size: 12px;
	display: inline-block;
	max-width: 100%;
	word-break: break-word;
}
.chat-form { padding: 8px; border-top: 1px solid #374151; display: flex; gap: 6px; }
.chat-field {
	flex: 1;
	background: #1f2937;
	border: 1px solid #374151;
	border-radius: 4px;
	padding: 6px 8px;
	color: #e5e7eb;
	font-size: 12px;
	outline: none;
}
.chat-send {
	background: #22c55e;
	color: #fff;
	border: 0;
	border-radius: 4px;
	padding: 6px 10px;
	font-size: 12px;
	cursor: pointer;
}
.controls {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 12px;
	padding: 14px;
	background: #1f2937;
	border-top: 1px solid #374151;
}
.ic-btn {
	width: 44px;
	height: 44px;
	border-radius: 50%;
	border: 0;
	color: #fff;
	font-size: 18px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
}
.ic-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.end-btn {
	margin-left: 12px;
	padding: 10px 18px;
	background: #ef4444;
	color: #fff;
	border: 0;
	border-radius: 24px;
	font-size: 13px;
	font-weight: 600;
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 6px;
}
.close-btn {
	padding: 8px 24px;
	background: #374151;
	color: #fff;
	border: 0;
	border-radius: 24px;
	font-size: 13px;
	cursor: pointer;
}
</style>
</head>
<body>
<div class="root">
	<div class="header" id="header"></div>
	<div class="body" id="body"></div>
	<div class="controls" id="controls"></div>
</div>
<script>
(function () {
	const vscode = acquireVsCodeApi();
	const ctx = {
		appointmentId: ${JSON.stringify(opts.appointmentId)},
		patientName: ${JSON.stringify(opts.patientName)},
		providerName: ${JSON.stringify(opts.providerName)},
		apiUrl: ${JSON.stringify(opts.apiUrl)},
		authToken: ${JSON.stringify(opts.authToken)},
		orgAlias: ${JSON.stringify(opts.orgAlias)},
		recordingMode: ${JSON.stringify(opts.recordingMode)},
	};

	const state = {
		session: null,
		callStatus: 'connecting', // connecting | connected | ended | error
		sessionError: '',
		videoEnabled: true,
		audioEnabled: true,
		recordingStatus: 'idle', // idle | starting | recording | stopping
		recordingError: '',
		chatOpen: false,
		chatMessages: [],
		chatInput: '',
		localStream: null,
	};

	function api(path, init) {
		const url = ctx.apiUrl + path;
		const headers = Object.assign({
			'Content-Type': 'application/json',
			'Authorization': 'Bearer ' + ctx.authToken,
		}, (init && init.headers) || {});
		if (ctx.orgAlias) { headers['X-Org-Alias'] = ctx.orgAlias; }
		return fetch(url, Object.assign({}, init, { headers: headers }));
	}

	function notify(message, severity) {
		vscode.postMessage({ type: 'notify', message: message, severity: severity || 'info' });
	}

	async function initSession() {
		try {
			const createRes = await api('/api/telehealth/sessions/from-appointment', {
				method: 'POST',
				body: JSON.stringify({ appointmentId: String(ctx.appointmentId) }),
			});
			if (!createRes.ok) {
				const text = await createRes.text();
				throw new Error(text || ('Failed to create session (HTTP ' + createRes.status + ')'));
			}
			const createJson = await createRes.json();
			let session = createJson.data || createJson;
			if (!session || !session.id) { throw new Error('No session id returned'); }

			if (session.status !== 'IN_PROGRESS') {
				try {
					const startRes = await api('/api/telehealth/sessions/' + session.id + '/start', { method: 'POST' });
					if (startRes.ok) {
						const startJson = await startRes.json();
						session = startJson.data || startJson || session;
					}
				} catch (_) { /* keep created session */ }
			}

			state.session = session;
			if (!(session.joinInfo && session.joinInfo.joinUrl)) {
				await startLocalPreview();
			}
			state.callStatus = 'connected';
			render();
		} catch (err) {
			state.sessionError = err && err.message ? err.message : 'Failed to load telehealth session';
			state.callStatus = 'error';
			render();
		}
	}

	async function startLocalPreview() {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
			state.localStream = stream;
			const el = document.getElementById('local-video');
			if (el) { el.srcObject = stream; }
		} catch (err) {
			notify('Could not access camera/microphone: ' + (err && err.message ? err.message : 'unknown error'), 'warning');
		}
	}

	function teardownLocalStream() {
		if (state.localStream) {
			state.localStream.getTracks().forEach(function (t) { t.stop(); });
			state.localStream = null;
		}
	}

	function toggleVideo() {
		state.videoEnabled = !state.videoEnabled;
		if (state.localStream) {
			state.localStream.getVideoTracks().forEach(function (t) { t.enabled = state.videoEnabled; });
		}
		render();
	}

	function toggleAudio() {
		state.audioEnabled = !state.audioEnabled;
		if (state.localStream) {
			state.localStream.getAudioTracks().forEach(function (t) { t.enabled = state.audioEnabled; });
		}
		render();
	}

	async function toggleRecording() {
		if (!state.session || !state.session.id) { return; }
		state.recordingError = '';
		try {
			if (state.recordingStatus === 'idle') {
				state.recordingStatus = 'starting';
				render();
				const res = await api('/api/telehealth/sessions/' + state.session.id + '/recording/start', {
					method: 'POST',
					body: JSON.stringify({ mode: ctx.recordingMode }),
				});
				if (!res.ok) { throw new Error((await res.text()) || 'Failed to start recording'); }
				state.recordingStatus = 'recording';
			} else if (state.recordingStatus === 'recording') {
				state.recordingStatus = 'stopping';
				render();
				const res = await api('/api/telehealth/sessions/' + state.session.id + '/recording/stop', { method: 'POST' });
				if (!res.ok) { throw new Error((await res.text()) || 'Failed to stop recording'); }
				state.recordingStatus = 'idle';
			}
		} catch (err) {
			state.recordingError = err && err.message ? err.message : 'Recording failed';
			state.recordingStatus = 'idle';
		}
		render();
	}

	async function endCall() {
		const sessionId = state.session && state.session.id;
		teardownLocalStream();
		state.callStatus = 'ended';
		render();
		if (sessionId) {
			try { await api('/api/telehealth/sessions/' + sessionId + '/end', { method: 'POST' }); } catch (_) { /* */ }
		}
		// Defer dispose so the user sees the "Call Ended" frame before the panel closes.
		setTimeout(function () { vscode.postMessage({ type: 'endCall' }); }, 600);
	}

	function sendChat() {
		const text = state.chatInput.trim();
		if (!text) { return; }
		state.chatMessages.push({ senderName: ctx.providerName || 'Provider', content: text, sentAt: new Date().toISOString() });
		state.chatInput = '';
		render();
	}

	// allow-any-unicode-next-line
	// ─── Rendering ──────────────────────────────────────────────────────

	function render() {
		renderHeader();
		renderBody();
		renderControls();
	}

	function renderHeader() {
		const h = document.getElementById('header');
		const peerName = (state.session && state.session.patientName) || ctx.patientName;
		const statusLabel = state.callStatus === 'connected' ? 'Connected'
			: state.callStatus === 'connecting' ? 'Connecting...'
			: state.callStatus === 'ended' ? 'Call ended'
			: 'Error';
		const recBadge = state.recordingStatus === 'recording'
			? '<span class="badge badge-rec">● Recording</span>'
			: '';
		const vendorBadge = state.session && state.session.providerType
			? '<span class="badge badge-vendor">' + escape(state.session.providerType) + '</span>'
			: '';
		h.innerHTML =
			'<div class="h-left">'
			+ '<span class="h-icon">\u{1F4F9}</span>'
			+ '<div><div class="h-title">Telehealth Session</div>'
			+ '<div class="h-sub">' + escape(peerName) + ' &middot; ' + escape(statusLabel) + '</div></div>'
			+ '</div>'
			+ '<div class="h-right">' + recBadge + vendorBadge + '</div>';
	}

	function renderBody() {
		const b = document.getElementById('body');
		b.innerHTML = '';

		if (state.callStatus === 'connecting' && !state.session) {
			b.innerHTML = '<div class="centered"><div class="spin"></div><div class="c-title">Joining telehealth session...</div><div class="c-sub">Please allow camera and microphone access when prompted.</div></div>';
			return;
		}
		if (state.callStatus === 'error' || state.sessionError) {
			b.innerHTML = '<div class="centered"><div class="c-title err">Unable to Join</div><div class="c-sub">' + escape(state.sessionError || 'Failed to connect to session') + '</div></div>';
			return;
		}
		if (state.callStatus === 'ended') {
			b.innerHTML = '<div class="centered"><div class="c-title err">Call Ended</div><div class="c-sub">The telehealth session has ended.</div></div>';
			return;
		}

		const join = (state.session && state.session.joinInfo) || {};

		if (join.joinUrl) {
			const frame = document.createElement('iframe');
			frame.className = 'vendor';
			frame.src = join.joinUrl;
			frame.allow = 'camera; microphone; display-capture; fullscreen; autoplay';
			frame.title = 'Telehealth Video Call';
			b.appendChild(frame);
		} else {
			const stage = document.createElement('div');
			stage.className = 'stage';
			const waiting = document.createElement('div');
			waiting.className = 'waiting';
			waiting.innerHTML = '<div class="w-icon">\u{1F465}</div><div class="w-text">Waiting for patient to join...</div>'
				+ (join.wsUrl ? '<div class="w-hint">Signaling: ' + escape(join.wsUrl) + '</div>' : '');
			stage.appendChild(waiting);

			const pip = document.createElement('div');
			pip.className = 'pip';
			pip.innerHTML = '<video id="local-video" autoplay playsinline muted></video>';
			if (!state.videoEnabled) {
				const off = document.createElement('div');
				off.className = 'video-off';
				off.textContent = '\u{1F4F7}\u{20E0}';
				pip.appendChild(off);
			}
			stage.appendChild(pip);
			b.appendChild(stage);

			// Re-attach existing local stream after re-render (DOM was wiped).
			if (state.localStream) {
				const v = document.getElementById('local-video');
				if (v) { v.srcObject = state.localStream; }
			}
		}

		if (state.chatOpen) { b.appendChild(renderChatPanel()); }
	}

	function renderChatPanel() {
		const panel = document.createElement('div');
		panel.className = 'chat';
		const head = '<div class="chat-head"><span class="chat-title">Chat</span>'
			+ '<button class="chat-close" id="chat-close">Close</button></div>';
		let list = '<div class="chat-list" id="chat-list">';
		for (let i = 0; i < state.chatMessages.length; i++) {
			const m = state.chatMessages[i];
			const when = new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			list += '<div><div class="chat-meta">' + escape(m.senderName) + ' &middot; ' + escape(when) + '</div>'
				+ '<div class="chat-bubble">' + escape(m.content) + '</div></div>';
		}
		list += '</div>';
		const form = '<div class="chat-form">'
			+ '<input id="chat-field" class="chat-field" type="text" placeholder="Type a message..." value="' + escape(state.chatInput) + '">'
			+ '<button id="chat-send" class="chat-send">Send</button></div>';
		panel.innerHTML = head + list + form;
		setTimeout(function () {
			document.getElementById('chat-close').onclick = function () { state.chatOpen = false; render(); };
			const f = document.getElementById('chat-field');
			f.oninput = function () { state.chatInput = f.value; };
			f.onkeydown = function (e) { if (e.key === 'Enter') { sendChat(); } };
			document.getElementById('chat-send').onclick = function () { sendChat(); };
			f.focus();
		}, 0);
		return panel;
	}

	function renderControls() {
		const c = document.getElementById('controls');
		c.innerHTML = '';
		if (state.callStatus === 'ended' || state.callStatus === 'error') {
			const close = document.createElement('button');
			close.className = 'close-btn';
			close.textContent = 'Close';
			close.onclick = function () { vscode.postMessage({ type: 'endCall' }); };
			c.appendChild(close);
			return;
		}
		const mkBtn = function (label, glyph, bg, onClick, disabled) {
			const b = document.createElement('button');
			b.className = 'ic-btn';
			b.title = label;
			b.style.background = bg;
			b.textContent = glyph;
			b.disabled = !!disabled;
			b.onclick = onClick;
			return b;
		};
		c.appendChild(mkBtn(state.audioEnabled ? 'Mute' : 'Unmute', state.audioEnabled ? '\u{1F3A4}' : '\u{1F507}', state.audioEnabled ? '#3b82f6' : '#ef4444', toggleAudio));
		c.appendChild(mkBtn(state.videoEnabled ? 'Turn off camera' : 'Turn on camera', state.videoEnabled ? '\u{1F4F9}' : '\u{1F4F7}', state.videoEnabled ? '#3b82f6' : '#ef4444', toggleVideo));
		c.appendChild(mkBtn('Chat', '\u{1F4AC}', state.chatOpen ? '#22c55e' : '#374151', function () { state.chatOpen = !state.chatOpen; render(); }));
		const isRec = state.recordingStatus === 'recording';
		const isToggling = state.recordingStatus === 'starting' || state.recordingStatus === 'stopping';
		c.appendChild(mkBtn(isRec ? 'Stop recording' : 'Start recording', isRec ? '\u{23F9}' : '\u{25CF}', isRec ? '#ef4444' : '#374151', toggleRecording, isToggling));

		const end = document.createElement('button');
		end.className = 'end-btn';
		end.textContent = '\u{1F4F4}  End Call';
		end.onclick = endCall;
		c.appendChild(end);
	}

	function escape(s) {
		if (s === null || s === undefined) { return ''; }
		return String(s).replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	render();
	initSession();
})();
</script>
</body>
</html>`;
}
