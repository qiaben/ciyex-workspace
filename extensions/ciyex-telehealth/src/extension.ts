/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Argument the workbench (or any caller) passes when invoking
 * `ciyex-telehealth.openSession`. The auth token + api url are forwarded
 * explicitly so this extension never depends on workbench-internal services
 * - only the public vscode extension API + plain HTTP.
 */
interface OpenSessionRequest {
	appointmentId: string;
	patientName?: string;
	providerName?: string;
	authToken: string;
	orgAlias?: string;
	apiUrl?: string;
	role?: 'provider' | 'patient';
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
	const apiUrl = (request.apiUrl || cfg.get<string>('apiUrl') || '').trim().replace(/\/$/, '');
	const recordingMode = cfg.get<'COMPOSITE' | 'INDIVIDUAL'>('recordingMode') ?? 'COMPOSITE';

	if (!apiUrl) {
		vscode.window.showErrorMessage('Telehealth: no API URL configured. Set ciyex.telehealth.apiUrl or pass apiUrl in the open request.');
		return;
	}
	if (!request.authToken) {
		vscode.window.showErrorMessage('Telehealth: missing auth token. The workbench must forward the user\'s bearer token when opening a session.');
		return;
	}

	const role = request.role || 'provider';
	const displayName = role === 'patient'
		? (request.patientName || 'Patient')
		: (request.providerName || 'Provider');
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
		displayName,
		role,
		apiUrl,
		authToken: request.authToken,
		orgAlias: request.orgAlias || '',
		recordingMode,
	});

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
	displayName: string;
	role: 'provider' | 'patient';
	apiUrl: string;
	authToken: string;
	orgAlias: string;
	recordingMode: 'COMPOSITE' | 'INDIVIDUAL';
}

/**
 * Render the telehealth webview. Implements the full mediasoup-client +
 * STOMP/SockJS signaling flow (port of ciyex-ehr-ui's MediasoupStompProvider)
 * directly inside a vscode webview - no browser redirect, no iframe to the
 * EHR-UI sign-in page. Iframe fallback is reserved for true iframe vendors
 * (Zoom, Doxy) where `joinUrl` is set without `wsUrl`.
 */
function renderSessionHtml(opts: RenderOptions): string {
	// CSP permits ESM module loads from esm.sh + WebSocket/HTTPS to anywhere
	// (API host, STOMP signaling host, mediasoup CDN). Inline-script needed
	// for the bootstrap that injects the runtime context.
	const csp = [
		`default-src 'none'`,
		`img-src https: data: blob:`,
		`style-src 'unsafe-inline'`,
		`script-src 'unsafe-inline' https://esm.sh https://cdn.esm.sh https://cdn.jsdelivr.net`,
		`connect-src 'self' https: wss: ws: https://esm.sh https://cdn.esm.sh https://cdn.jsdelivr.net`,
		`frame-src https:`,
		`media-src 'self' blob: mediastream:`,
		`worker-src 'self' blob:`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
.badge { font-size: 10px; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
.badge-vendor { color: #9ca3af; background: #374151; }
.badge-rec { color: #fca5a5; background: rgba(127, 29, 29, 0.4); animation: pulse 2s infinite; }
.badge-peers { color: #86efac; background: rgba(20, 83, 45, 0.4); }
.badge-err { color: #fcd34d; background: rgba(120, 53, 15, 0.4); }
@keyframes pulse { 50% { opacity: 0.6; } }

.body {
	flex: 1;
	position: relative;
	display: flex;
	background: #030712;
	min-height: 0;
	overflow: hidden;
}
.stage { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; background: #030712; }
.remote-video { width: 100%; height: 100%; object-fit: cover; background: #030712; }
.waiting { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: #6b7280; }
.w-icon { font-size: 48px; opacity: 0.5; }
.w-text { font-size: 14px; color: #9ca3af; }
.w-hint { font-size: 10px; color: #4b5563; margin-top: 6px; word-break: break-all; padding: 0 16px; text-align: center; }

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
	z-index: 2;
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
.c-sub { font-size: 12px; color: #9ca3af; max-width: 480px; line-height: 1.5; word-break: break-word; }

.chat {
	width: 320px;
	border-left: 1px solid #374151;
	background: #111827;
	display: flex;
	flex-direction: column;
	z-index: 1;
}
.chat-head { padding: 10px 12px; border-bottom: 1px solid #374151; display: flex; justify-content: space-between; align-items: center; }
.chat-title { font-size: 13px; font-weight: 600; color: #fff; }
.chat-close { background: transparent; border: 0; color: #9ca3af; cursor: pointer; font-size: 11px; }
.chat-list { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.chat-msg { display: flex; flex-direction: column; }
.chat-msg.self { align-items: flex-end; }
.chat-meta { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
.chat-bubble {
	color: #fff;
	padding: 6px 10px;
	border-radius: 8px;
	font-size: 12px;
	display: inline-block;
	max-width: 90%;
	word-break: break-word;
}
.chat-msg.self .chat-bubble { background: #22c55e; }
.chat-msg.peer .chat-bubble { background: #374151; }
.chat-form { padding: 8px; border-top: 1px solid #374151; display: flex; gap: 6px; }
.chat-field { flex: 1; background: #1f2937; border: 1px solid #374151; border-radius: 4px; padding: 6px 8px; color: #e5e7eb; font-size: 12px; outline: none; }
.chat-field:focus { border-color: #22c55e; }
.chat-send { background: #22c55e; color: #fff; border: 0; border-radius: 4px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.chat-send:disabled { opacity: 0.4; cursor: not-allowed; }

.controls { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 14px; background: #1f2937; border-top: 1px solid #374151; }
.ic-btn {
	width: 44px; height: 44px;
	border-radius: 50%;
	border: 0;
	color: #fff;
	font-size: 18px;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: background 150ms;
}
.ic-btn:hover { filter: brightness(1.1); }
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
.close-btn { padding: 8px 24px; background: #374151; color: #fff; border: 0; border-radius: 24px; font-size: 13px; cursor: pointer; }
</style>
</head>
<body>
<div class="root">
	<div class="header" id="header"></div>
	<div class="body" id="body"></div>
	<div class="controls" id="controls"></div>
</div>

<script>
// Runtime context. Stays inline so the rest can be an ESM module that
// imports it from window.
window.__CTX = {
	appointmentId: ${JSON.stringify(opts.appointmentId)},
	patientName: ${JSON.stringify(opts.patientName)},
	providerName: ${JSON.stringify(opts.providerName)},
	displayName: ${JSON.stringify(opts.displayName)},
	role: ${JSON.stringify(opts.role)},
	apiUrl: ${JSON.stringify(opts.apiUrl)},
	authToken: ${JSON.stringify(opts.authToken)},
	orgAlias: ${JSON.stringify(opts.orgAlias)},
	recordingMode: ${JSON.stringify(opts.recordingMode)},
};
</script>

<script type="module">
// --- Telehealth webview: port of ciyex-ehr-ui MediasoupStompProvider ---
//
// Dependencies loaded from esm.sh (CDN). Keep these pinned to avoid drift.
import { Device } from 'https://esm.sh/mediasoup-client@3.7.18';
import { Client } from 'https://esm.sh/@stomp/stompjs@7.0.0';
import SockJS from 'https://esm.sh/sockjs-client@1.6.1';

const vscode = acquireVsCodeApi();
const ctx = window.__CTX;

// === State ===
const state = {
	session: null,
	callStatus: 'connecting',        // connecting | connected | ended | error
	sessionError: '',
	videoEnabled: true,
	audioEnabled: true,
	recordingStatus: 'idle',         // idle | starting | recording | stopping
	recordingError: '',
	chatOpen: false,
	chatMessages: [],
	chatInput: '',
	remotePeers: new Map(),          // peerId -> { displayName }
	mediasoupErr: '',
	signalingHint: '',
};

let localStream = null;
let provider = null;                 // MediasoupStompProvider instance for current session

// === API helper ===
function notify(message, severity) {
	vscode.postMessage({ type: 'notify', message, severity: severity || 'info' });
}

async function api(path, init) {
	const url = ctx.apiUrl + path;
	const headers = Object.assign({
		'Content-Type': 'application/json',
		'Authorization': 'Bearer ' + ctx.authToken,
	}, (init && init.headers) || {});
	if (ctx.orgAlias) { headers['X-Org-Alias'] = ctx.orgAlias; }
	return fetch(url, Object.assign({}, init, { headers }));
}

// === Session bootstrap ===
async function initSession() {
	try {
		const createRes = await api('/api/telehealth/sessions/from-appointment', {
			method: 'POST',
			body: JSON.stringify({ appointmentId: String(ctx.appointmentId) }),
		});
		if (!createRes.ok) {
			throw new Error((await createRes.text()) || ('Failed to create session (HTTP ' + createRes.status + ')'));
		}
		const createJson = await createRes.json();
		let session = createJson.data || createJson;
		if (!session || !session.id) { throw new Error('No session id returned'); }

		// Provider starts the session if not already in progress.
		if (ctx.role === 'provider' && session.status !== 'IN_PROGRESS') {
			try {
				const startRes = await api('/api/telehealth/sessions/' + session.id + '/start', { method: 'POST' });
				if (startRes.ok) {
					const startJson = await startRes.json();
					session = startJson.data || startJson || session;
				}
			} catch (_) { /* keep current session */ }
		}

		state.session = session;
		render();

		// Iframe-only vendor → skip mediasoup. Otherwise connect WebRTC.
		const join = session.joinInfo || {};
		const isIframe = !!join.joinUrl && !join.wsUrl;
		if (isIframe) {
			state.callStatus = 'connected';
			render();
		} else {
			await connectMediasoup(session);
		}
	} catch (err) {
		state.sessionError = err && err.message ? err.message : 'Failed to load telehealth session';
		state.callStatus = 'error';
		render();
	}
}

// === MediasoupStompProvider (port) ===
class MediasoupStompProvider {
	constructor(session, displayName, remoteVideoEl) {
		this.session = session;
		this.displayName = displayName;
		this.remoteVideoEl = remoteVideoEl;
		this.sessionId = session.id;
		this.userId = displayName.toLowerCase().replace(/\\s+/g, '-') + '-' + Date.now();
		this.stompClient = null;
		this.device = null;
		this.sendTransport = null;
		this.recvTransport = null;
		this.audioProducer = null;
		this.videoProducer = null;
		this.consumers = new Map();
		this.pendingProduceCallbacks = new Map();
		this.joinTimeout = null;
	}

	async connect() {
		// Resolve signaling URL. Order of preference:
		//   1. session.joinInfo.wsUrl (returned by backend SDK)
		//   2. derive /ws/telehealth on the API host
		const wsHint = this.session.joinInfo && this.session.joinInfo.wsUrl;
		const sockUrl = this._toSockJsUrl(wsHint) || this._deriveFromApi();
		if (!sockUrl) {
			throw new Error('Session missing signaling URL - check telehealth vendor config');
		}
		state.signalingHint = sockUrl;
		render();

		await this._connectSignaling(sockUrl);
	}

	_toSockJsUrl(wsUrl) {
		if (!wsUrl) { return null; }
		// SockJS expects HTTP(S), not WS(S). Convert wss:// → https://, ws:// → http://.
		return wsUrl.replace(/^ws:\\/\\//i, 'http://').replace(/^wss:\\/\\//i, 'https://');
	}

	_deriveFromApi() {
		try {
			const u = new URL(ctx.apiUrl);
			return u.protocol + '//' + u.host + '/ws/telehealth';
		} catch (_) { return null; }
	}

	_connectSignaling(sockjsUrl) {
		return new Promise((resolve) => {
			// 20s deadline waiting for "joined" message from server
			this.joinTimeout = setTimeout(() => {
				try { this.stompClient && this.stompClient.deactivate().catch(() => {}); } catch (_) {}
				state.mediasoupErr = 'Could not connect to session - the telehealth server may be unavailable or the session has ended.';
				state.callStatus = 'error';
				render();
				resolve();
			}, 20000);

			const client = new Client({
				webSocketFactory: () => new SockJS(sockjsUrl, null, { transports: ['websocket', 'xhr-polling'] }),
				connectHeaders: { Authorization: 'Bearer ' + ctx.authToken },
				reconnectDelay: 5000,
				heartbeatIncoming: 10000,
				heartbeatOutgoing: 10000,
				debug: () => {},
			});

			client.onConnect = () => {
				const sid = this.sessionId;
				const uid = this.userId;

				client.subscribe('/topic/signal/' + uid, (msg) => {
					this._onSignal(JSON.parse(msg.body));
				});
				client.subscribe('/topic/session/' + sid + '/join', (msg) => {
					const p = JSON.parse(msg.body);
					if (p.type === 'peer-joined' && p.peerId !== uid) {
						state.remotePeers.set(p.peerId, { displayName: p.displayName || '' });
						render();
					}
				});
				client.subscribe('/topic/session/' + sid + '/producer', (msg) => {
					const p = JSON.parse(msg.body);
					if (p.type === 'new-producer' && p.peerId !== uid) {
						this._consume(p.producerId, p.kind);
					}
				});
				client.subscribe('/topic/session/' + sid + '/leave', (msg) => {
					const p = JSON.parse(msg.body);
					if (p.type === 'peer-left') {
						state.remotePeers.delete(p.peerId);
						render();
					}
				});
				client.subscribe('/topic/session/' + sid + '/chat', (msg) => {
					const p = JSON.parse(msg.body);
					state.chatMessages.push({ senderId: p.senderId, senderName: p.senderName, content: p.content, sentAt: p.sentAt || new Date().toISOString() });
					render();
				});

				client.publish({ destination: '/app/session/' + sid + '/join', body: JSON.stringify({ userId: uid, displayName: this.displayName }) });
				resolve();
			};

			client.onStompError = (frame) => {
				if (this.joinTimeout) { clearTimeout(this.joinTimeout); this.joinTimeout = null; }
				try { client.deactivate().catch(() => {}); } catch (_) {}
				state.mediasoupErr = 'Signaling error: ' + (frame.headers && frame.headers.message ? frame.headers.message : 'unknown');
				state.callStatus = 'error';
				render();
				resolve();
			};

			client.onWebSocketClose = () => {
				if (this.joinTimeout) {
					clearTimeout(this.joinTimeout); this.joinTimeout = null;
					try { client.deactivate().catch(() => {}); } catch (_) {}
					state.mediasoupErr = 'Cannot reach the telehealth server. Check your connection and try again.';
					state.callStatus = 'error';
					render();
					resolve();
				}
			};

			client.activate();
			this.stompClient = client;
		});
	}

	async _onSignal(payload) {
		switch (payload.type) {
			case 'joined':   await this._setupMediasoup(payload); break;
			case 'consumed': await this._onConsumed(payload); break;
			case 'produced': {
				const cb = this.pendingProduceCallbacks.get(payload.kind);
				if (cb) { this.pendingProduceCallbacks.delete(payload.kind); cb({ id: payload.producerId }); }
				break;
			}
			case 'error':
				state.mediasoupErr = payload.message || 'Server error';
				render();
				break;
		}
	}

	async _setupMediasoup(joinData) {
		if (this.joinTimeout) { clearTimeout(this.joinTimeout); this.joinTimeout = null; }
		try {
			const device = new Device();
			await device.load({ routerRtpCapabilities: joinData.routerRtpCapabilities });
			this.device = device;
			const sid = this.sessionId;
			const uid = this.userId;

			const sendTransport = device.createSendTransport({
				id: joinData.sendTransport.id,
				iceParameters: joinData.sendTransport.iceParameters,
				iceCandidates: joinData.sendTransport.iceCandidates,
				dtlsParameters: joinData.sendTransport.dtlsParameters,
				sctpParameters: joinData.sendTransport.sctpParameters,
				iceServers: joinData.iceServers || [],
			});
			sendTransport.on('connect', ({ dtlsParameters }, cb) => {
				this.stompClient.publish({
					destination: '/app/session/' + sid + '/connect-transport',
					body: JSON.stringify({ userId: uid, transportId: sendTransport.id, dtlsParameters }),
				});
				cb();
			});
			sendTransport.on('produce', ({ kind, rtpParameters, appData }, cb) => {
				this.pendingProduceCallbacks.set(kind, cb);
				this.stompClient.publish({
					destination: '/app/session/' + sid + '/produce',
					body: JSON.stringify({ userId: uid, transportId: sendTransport.id, kind, rtpParameters, appData }),
				});
			});
			sendTransport.on('connectionstatechange', (s) => {
				if (s === 'failed') {
					state.mediasoupErr = 'Your network cannot send media. Check firewall/VPN and rejoin.';
					render();
				}
			});
			this.sendTransport = sendTransport;

			const recvTransport = device.createRecvTransport({
				id: joinData.recvTransport.id,
				iceParameters: joinData.recvTransport.iceParameters,
				iceCandidates: joinData.recvTransport.iceCandidates,
				dtlsParameters: joinData.recvTransport.dtlsParameters,
				sctpParameters: joinData.recvTransport.sctpParameters,
				iceServers: joinData.iceServers || [],
			});
			recvTransport.on('connect', ({ dtlsParameters }, cb) => {
				this.stompClient.publish({
					destination: '/app/session/' + sid + '/connect-transport',
					body: JSON.stringify({ userId: uid, transportId: recvTransport.id, dtlsParameters }),
				});
				cb();
			});
			recvTransport.on('connectionstatechange', (s) => {
				if (s === 'failed') {
					state.mediasoupErr = 'Cannot receive remote audio/video. Check network and rejoin.';
					render();
				}
			});
			this.recvTransport = recvTransport;

			if (localStream) {
				const audio = localStream.getAudioTracks()[0];
				const video = localStream.getVideoTracks()[0];
				if (audio) { this.audioProducer = await sendTransport.produce({ track: audio }); }
				if (video) { this.videoProducer = await sendTransport.produce({ track: video }); }
			}

			if (joinData.existingProducers && joinData.existingProducers.length) {
				for (const ep of joinData.existingProducers) {
					if (ep.peerId !== uid) {
						this._consume(ep.producerId, ep.kind);
						if (ep.peerId) {
							state.remotePeers.set(ep.peerId, { displayName: ep.displayName || '' });
						}
					}
				}
			}

			state.callStatus = 'connected';
			render();
		} catch (err) {
			state.mediasoupErr = 'mediasoup setup error: ' + (err && err.message ? err.message : String(err));
			state.callStatus = 'error';
			render();
		}
	}

	_consume(producerId, kind) {
		if (!this.recvTransport || !this.device) { return; }
		this.stompClient.publish({
			destination: '/app/session/' + this.sessionId + '/consume',
			body: JSON.stringify({
				userId: this.userId,
				transportId: this.recvTransport.id,
				producerId,
				rtpCapabilities: this.device.rtpCapabilities,
			}),
		});
	}

	async _onConsumed(payload) {
		if (!this.recvTransport) { return; }
		try {
			const consumer = await this.recvTransport.consume({
				id: payload.consumerId,
				producerId: payload.producerId,
				kind: payload.kind,
				rtpParameters: payload.rtpParameters,
			});
			this.consumers.set(consumer.id, consumer);
			this.stompClient.publish({
				destination: '/app/session/' + this.sessionId + '/consumer-resume',
				body: JSON.stringify({ consumerId: consumer.id, userId: this.userId }),
			});
			const el = this.remoteVideoEl;
			if (el) {
				const existing = el.srcObject;
				const stream = existing || new MediaStream();
				stream.addTrack(consumer.track);
				if (!existing) { el.srcObject = stream; }
			}
		} catch (err) {
			// swallow - UI will reflect via missing stream
		}
	}

	toggleVideo() {
		const track = localStream && localStream.getVideoTracks()[0];
		if (!track) { return; }
		track.enabled = !track.enabled;
		try {
			this.stompClient && this.stompClient.publish({
				destination: '/app/session/' + this.sessionId + '/producer-toggle',
				body: JSON.stringify({ userId: this.userId, producerId: this.videoProducer && this.videoProducer.id, kind: 'video', paused: !track.enabled }),
			});
		} catch (_) {}
		state.videoEnabled = track.enabled;
		render();
	}

	toggleAudio() {
		const track = localStream && localStream.getAudioTracks()[0];
		if (!track) { return; }
		track.enabled = !track.enabled;
		try {
			this.stompClient && this.stompClient.publish({
				destination: '/app/session/' + this.sessionId + '/producer-toggle',
				body: JSON.stringify({ userId: this.userId, producerId: this.audioProducer && this.audioProducer.id, kind: 'audio', paused: !track.enabled }),
			});
		} catch (_) {}
		state.audioEnabled = track.enabled;
		render();
	}

	sendChat(content) {
		if (!this.stompClient || !this.stompClient.connected) { return; }
		this.stompClient.publish({
			destination: '/app/session/' + this.sessionId + '/chat',
			body: JSON.stringify({ senderId: this.userId, senderName: this.displayName, content }),
		});
	}

	async disconnect() {
		try {
			this.stompClient && this.stompClient.publish({
				destination: '/app/session/' + this.sessionId + '/leave',
				body: JSON.stringify({ userId: this.userId }),
			});
		} catch (_) {}
		this.audioProducer && this.audioProducer.close();
		this.videoProducer && this.videoProducer.close();
		this.consumers.forEach(c => c.close());
		this.consumers.clear();
		this.sendTransport && this.sendTransport.close();
		this.recvTransport && this.recvTransport.close();
		try { this.stompClient && await this.stompClient.deactivate(); } catch (_) {}
		this.stompClient = null;
	}
}

async function connectMediasoup(session) {
	// Acquire local media first so the user sees themselves immediately.
	try {
		localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
		const localEl = document.getElementById('local-video');
		if (localEl) { localEl.srcObject = localStream; }
	} catch (err) {
		notify('Could not access camera/microphone: ' + (err && err.message ? err.message : 'unknown'), 'warning');
		state.videoEnabled = false; state.audioEnabled = false;
	}

	const remoteEl = document.getElementById('remote-video');
	provider = new MediasoupStompProvider(session, ctx.displayName, remoteEl);
	try { await provider.connect(); } catch (err) {
		state.mediasoupErr = err && err.message ? err.message : 'Failed to connect';
		state.callStatus = 'error';
		render();
	}
}

// === Controls ===
function toggleVideo() { if (provider) { provider.toggleVideo(); } else if (localStream) { const t = localStream.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; state.videoEnabled = t.enabled; render(); } } }
function toggleAudio() { if (provider) { provider.toggleAudio(); } else if (localStream) { const t = localStream.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; state.audioEnabled = t.enabled; render(); } } }
function toggleChatPanel() { state.chatOpen = !state.chatOpen; render(); }

function sendChat() {
	const text = (state.chatInput || '').trim();
	if (!text) { return; }
	// Echo locally so the sender sees the bubble immediately even if the
	// server doesn't broadcast back to the sender.
	state.chatMessages.push({ senderId: provider ? provider.userId : 'self', senderName: ctx.displayName, content: text, sentAt: new Date().toISOString() });
	if (provider) { provider.sendChat(text); }
	state.chatInput = '';
	render();
}

async function toggleRecording() {
	if (!state.session || !state.session.id) { return; }
	state.recordingError = '';
	try {
		if (state.recordingStatus === 'idle') {
			state.recordingStatus = 'starting'; render();
			const res = await api('/api/telehealth/sessions/' + state.session.id + '/recording/start', {
				method: 'POST',
				body: JSON.stringify({ mode: ctx.recordingMode }),
			});
			if (!res.ok) { throw new Error((await res.text()) || 'Failed to start recording'); }
			state.recordingStatus = 'recording';
		} else if (state.recordingStatus === 'recording') {
			state.recordingStatus = 'stopping'; render();
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
	const sid = state.session && state.session.id;
	if (provider) { try { await provider.disconnect(); } catch (_) {} }
	if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
	state.callStatus = 'ended';
	render();
	if (sid && ctx.role === 'provider') {
		try { await api('/api/telehealth/sessions/' + sid + '/end', { method: 'POST' }); } catch (_) {}
	}
	setTimeout(() => { vscode.postMessage({ type: 'endCall' }); }, 800);
}

// === Rendering ===
function esc(s) {
	if (s === null || s === undefined) { return ''; }
	return String(s).replace(/[&<>\"']/g, function (c) {
		return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
	});
}

function render() { renderHeader(); renderBody(); renderControls(); }

function renderHeader() {
	const h = document.getElementById('header');
	const peerName = (state.session && state.session.patientName) || (ctx.role === 'provider' ? ctx.patientName : ctx.providerName);
	const statusLabel = state.callStatus === 'connected' ? 'Connected'
		: state.callStatus === 'connecting' ? 'Connecting...'
		: state.callStatus === 'ended' ? 'Call ended'
		: 'Error';
	const recBadge = state.recordingStatus === 'recording' ? '<span class="badge badge-rec">\u{25CF} Recording</span>' : '';
	const errBadge = state.mediasoupErr ? '<span class="badge badge-err">⚠ ' + esc(state.mediasoupErr) + '</span>' : '';
	const peersBadge = state.remotePeers.size > 0 ? '<span class="badge badge-peers">\u{1F465} ' + (state.remotePeers.size + 1) + '</span>' : '';
	const providerType = (state.session && state.session.providerType) || 'mediasoup';
	const vendorBadge = '<span class="badge badge-vendor">' + esc(providerType) + '</span>';
	h.innerHTML =
		'<div class="h-left">'
		+ '<span class="h-icon">\u{1F4F9}</span>'
		+ '<div><div class="h-title">Telehealth Session</div>'
		+ '<div class="h-sub">' + esc(peerName) + ' • ' + esc(statusLabel) + '</div></div>'
		+ '</div>'
		+ '<div class="h-right">' + recBadge + errBadge + peersBadge + vendorBadge + '</div>';
}

function renderBody() {
	const b = document.getElementById('body');
	b.innerHTML = '';

	if (state.callStatus === 'connecting' && !state.session) {
		b.innerHTML = '<div class="centered"><div class="spin"></div><div class="c-title">Joining telehealth session...</div><div class="c-sub">Please allow camera and microphone access when prompted.</div></div>';
		return;
	}
	if (state.callStatus === 'error' && !state.session) {
		b.innerHTML = '<div class="centered"><div class="c-title err">Unable to Join</div><div class="c-sub">' + esc(state.sessionError || state.mediasoupErr || 'Connection error') + '</div></div>';
		return;
	}
	if (state.callStatus === 'ended') {
		b.innerHTML = '<div class="centered"><div class="c-title err">Call Ended</div><div class="c-sub">The telehealth session has ended.</div></div>';
		return;
	}

	const join = (state.session && state.session.joinInfo) || {};
	const isIframe = !!join.joinUrl && !join.wsUrl;

	if (isIframe) {
		const frame = document.createElement('iframe');
		frame.className = 'vendor';
		frame.src = join.joinUrl;
		frame.allow = 'camera; microphone; display-capture; fullscreen; autoplay';
		frame.title = 'Telehealth Video Call';
		b.appendChild(frame);
	} else {
		const stage = document.createElement('div');
		stage.className = 'stage';

		const remote = document.createElement('video');
		remote.id = 'remote-video';
		remote.className = 'remote-video';
		remote.autoplay = true;
		remote.playsInline = true;
		stage.appendChild(remote);

		if (state.remotePeers.size === 0) {
			const waiting = document.createElement('div');
			waiting.className = 'waiting';
			waiting.innerHTML = '<div class="w-icon">\u{1F465}</div><div class="w-text">'
				+ (ctx.role === 'provider' ? 'Waiting for patient to join...' : 'Waiting for your provider...')
				+ '</div>'
				+ (state.signalingHint ? '<div class="w-hint">Signaling: ' + esc(state.signalingHint) + '</div>' : '');
			stage.appendChild(waiting);
		}

		const pip = document.createElement('div');
		pip.className = 'pip';
		pip.innerHTML = '<video id="local-video" autoplay playsinline muted></video>';
		if (!state.videoEnabled) {
			const off = document.createElement('div');
			off.className = 'video-off';
			off.textContent = '\u{1F3A5}';
			pip.appendChild(off);
		}
		stage.appendChild(pip);
		b.appendChild(stage);

		// Re-attach existing local stream after re-render (DOM was wiped).
		if (localStream) {
			const v = document.getElementById('local-video');
			if (v) { v.srcObject = localStream; }
		}
	}

	if (state.chatOpen) { b.appendChild(renderChatPanel()); }
}

function renderChatPanel() {
	const panel = document.createElement('div');
	panel.className = 'chat';
	const me = ctx.displayName;

	let listHtml = '<div class="chat-list" id="chat-list">';
	for (const m of state.chatMessages) {
		const self = m.senderName === me;
		const when = new Date(m.sentAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		listHtml += '<div class="chat-msg ' + (self ? 'self' : 'peer') + '">'
			+ '<div class="chat-meta">' + esc(m.senderName) + ' • ' + esc(when) + '</div>'
			+ '<div class="chat-bubble">' + esc(m.content) + '</div></div>';
	}
	listHtml += '</div>';

	panel.innerHTML =
		'<div class="chat-head">'
		+ '<span class="chat-title">Chat</span>'
		+ '<button class="chat-close" id="chat-close">Close</button>'
		+ '</div>'
		+ listHtml
		+ '<div class="chat-form">'
		+ '<input id="chat-field" class="chat-field" type="text" placeholder="Type a message..." value="' + esc(state.chatInput) + '">'
		+ '<button id="chat-send" class="chat-send">Send</button>'
		+ '</div>';

	setTimeout(() => {
		document.getElementById('chat-close').onclick = toggleChatPanel;
		const f = document.getElementById('chat-field');
		f.oninput = () => { state.chatInput = f.value; };
		f.onkeydown = (e) => { if (e.key === 'Enter') { sendChat(); } };
		document.getElementById('chat-send').onclick = sendChat;
		f.focus();
		const list = document.getElementById('chat-list');
		if (list) { list.scrollTop = list.scrollHeight; }
	}, 0);

	return panel;
}

function renderControls() {
	const c = document.getElementById('controls');
	c.innerHTML = '';
	if (state.callStatus === 'ended' || (state.callStatus === 'error' && !state.session)) {
		const close = document.createElement('button');
		close.className = 'close-btn';
		close.textContent = 'Close';
		close.onclick = () => vscode.postMessage({ type: 'endCall' });
		c.appendChild(close);
		return;
	}
	const mk = (label, glyph, bg, onClick, disabled) => {
		const b = document.createElement('button');
		b.className = 'ic-btn';
		b.title = label;
		b.style.background = bg;
		b.textContent = glyph;
		b.disabled = !!disabled;
		b.onclick = onClick;
		return b;
	};
	c.appendChild(mk(state.audioEnabled ? 'Mute' : 'Unmute', state.audioEnabled ? '\u{1F399}️' : '\u{1F507}', state.audioEnabled ? '#3b82f6' : '#ef4444', toggleAudio));
	c.appendChild(mk(state.videoEnabled ? 'Turn off camera' : 'Turn on camera', state.videoEnabled ? '\u{1F4F9}' : '\u{1F4F7}', state.videoEnabled ? '#3b82f6' : '#ef4444', toggleVideo));
	c.appendChild(mk('Chat', '\u{1F4AC}', state.chatOpen ? '#22c55e' : '#374151', toggleChatPanel));

	if (ctx.role === 'provider') {
		const isRec = state.recordingStatus === 'recording';
		const isToggling = state.recordingStatus === 'starting' || state.recordingStatus === 'stopping';
		c.appendChild(mk(isRec ? 'Stop recording' : 'Start recording', isRec ? '\u{23F9}' : '\u{25CF}', isRec ? '#ef4444' : '#374151', toggleRecording, isToggling));
	}

	const end = document.createElement('button');
	end.className = 'end-btn';
	end.textContent = '\u{1F4F4} End Call';
	end.onclick = endCall;
	c.appendChild(end);
}

// === Boot ===
render();
initSession();
</script>
</body>
</html>`;
}
