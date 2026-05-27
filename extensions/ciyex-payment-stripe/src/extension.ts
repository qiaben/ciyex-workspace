/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Payload the workbench sends when it triggers checkout. Mirrors
 * `CheckoutRequest` in the workbench-side ciyexPaymentService.ts so the
 * type lives in only one place at the call site.
 */
interface CheckoutRequest {
	appSlug: string;
	appName: string;
	pricingPlanId: string;
	planName: string;
	priceCents: number;
	currency: string;
	interval?: 'month' | 'year' | 'one_time';
	/** Stripe PaymentIntent client_secret returned by ciyex-marketplace when
	 *  the subscription was created server-side. Without this the Stripe.js
	 *  Payment Element cannot render — we surface a clear error in that case. */
	clientSecret?: string;
	/** Bearer token forwarded so this extension can talk to ciyex-marketplace
	 *  for `clientSecret` fetch / install polling without re-implementing auth. */
	authToken?: string;
	orgAlias?: string;
}

/**
 * Result posted back to the workbench on completion. Workbench reacts by
 * (a) polling /app-installations until the extension activates, or
 * (b) surfacing the error message to the user.
 */
interface CheckoutResult {
	status: 'success' | 'cancelled' | 'error';
	appSlug: string;
	message?: string;
}

interface GatewayRegistration {
	id: string;
	displayName: string;
	/** Command the workbench invokes to start checkout. */
	checkoutCommand: string;
	/** Optional command to open gateway-specific settings UI. */
	configureCommand?: string;
}

const GATEWAY_ID = 'stripe';
const CHECKOUT_COMMAND = 'ciyex-payment-stripe.checkout';
const CONFIGURE_COMMAND = 'ciyex-payment-stripe.configure';
const REGISTER_COMMAND = 'ciyex.payment.registerGateway';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(
		vscode.commands.registerCommand(CHECKOUT_COMMAND, async (request: CheckoutRequest | undefined) => {
			if (!request || !request.appSlug) {
				vscode.window.showWarningMessage('Stripe checkout was invoked without a purchase request.');
				return;
			}
			return runCheckout(context, request);
		}),
		vscode.commands.registerCommand(CONFIGURE_COMMAND, () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'ciyex.payment.stripe');
		}),
	);

	// Announce this gateway to the workbench. The workbench command is
	// registered by the ciyexEhr workbench contribution at startup; we wait
	// for it to be available (it might activate after us) and retry briefly.
	await registerWithWorkbench();
}

async function registerWithWorkbench(): Promise<void> {
	const registration: GatewayRegistration = {
		id: GATEWAY_ID,
		displayName: 'Stripe',
		checkoutCommand: CHECKOUT_COMMAND,
		configureCommand: CONFIGURE_COMMAND,
	};
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const all = await vscode.commands.getCommands(true);
		if (all.includes(REGISTER_COMMAND)) {
			try {
				await vscode.commands.executeCommand(REGISTER_COMMAND, registration);
				return;
			} catch (err) {
				console.warn('[ciyex-payment-stripe] registerGateway failed', err);
				return;
			}
		}
		await new Promise(r => setTimeout(r, 500));
	}
	console.warn('[ciyex-payment-stripe] workbench did not expose', REGISTER_COMMAND, '— Stripe gateway is loaded but unreachable.');
}

export function deactivate(): void { /* no-op */ }

/**
 * Open a webview panel and run the Stripe checkout flow inside it. The
 * workbench is notified of the result via a typed channel rather than a
 * shared service — extensions and the workbench live in different host
 * processes so we route everything through commands.
 */
async function runCheckout(context: vscode.ExtensionContext, request: CheckoutRequest): Promise<CheckoutResult> {
	const cfg = vscode.workspace.getConfiguration('ciyex.payment.stripe');
	const publishableKey = (cfg.get<string>('publishableKey') || '').trim();
	const mode = cfg.get<'TEST' | 'LIVE'>('mode') ?? 'TEST';

	if (!publishableKey) {
		const choice = await vscode.window.showErrorMessage(
			'Stripe publishable key is not configured. Open settings to add it?',
			'Open Settings',
			'Cancel',
		);
		if (choice === 'Open Settings') {
			vscode.commands.executeCommand(CONFIGURE_COMMAND);
		}
		return { status: 'error', appSlug: request.appSlug, message: 'No publishable key configured.' };
	}
	if (!request.clientSecret) {
		const message = 'No payment intent client_secret on the request. The marketplace subscription endpoint must include clientSecret in its response.';
		vscode.window.showErrorMessage(message);
		return { status: 'error', appSlug: request.appSlug, message };
	}

	const panel = vscode.window.createWebviewPanel(
		'ciyexPaymentStripeCheckout',
		`Checkout: ${request.appName}`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		},
	);

	panel.webview.html = renderCheckoutHtml({
		publishableKey,
		mode,
		clientSecret: request.clientSecret,
		appName: request.appName,
		planName: request.planName,
		priceCents: request.priceCents,
		currency: request.currency,
		interval: request.interval,
	});

	return new Promise<CheckoutResult>(resolve => {
		const sub = panel.webview.onDidReceiveMessage((msg: { type: string; message?: string }) => {
			switch (msg.type) {
				case 'paid':
					resolve({ status: 'success', appSlug: request.appSlug });
					panel.dispose();
					break;
				case 'failed':
					vscode.window.showErrorMessage(`Payment failed: ${msg.message ?? 'unknown error'}`);
					resolve({ status: 'error', appSlug: request.appSlug, message: msg.message });
					break;
				case 'cancel':
					resolve({ status: 'cancelled', appSlug: request.appSlug });
					panel.dispose();
					break;
			}
		});
		const dispSub = panel.onDidDispose(() => {
			sub.dispose();
			dispSub.dispose();
			resolve({ status: 'cancelled', appSlug: request.appSlug });
		});
	});
}

interface RenderOptions {
	publishableKey: string;
	mode: 'TEST' | 'LIVE';
	clientSecret: string;
	appName: string;
	planName: string;
	priceCents: number;
	currency: string;
	interval?: 'month' | 'year' | 'one_time';
}

/**
 * Render the checkout HTML. We inline the script so the webview is a single
 * document — no separate JS file to ship in the extension bundle. Stripe.js
 * is loaded from js.stripe.com (required by Stripe's terms of service —
 * self-hosting the SDK is not permitted).
 */
function renderCheckoutHtml(opts: RenderOptions): string {
	const amount = formatAmount(opts.priceCents, opts.currency);
	const intervalLabel = opts.interval && opts.interval !== 'one_time'
		? ` per ${opts.interval === 'month' ? 'month' : 'year'}`
		: '';
	const modeBadge = opts.mode === 'TEST' ? '<span class="badge">TEST MODE</span>' : '';

	// Stripe.js requires a strict CSP-friendly load. The default vscode
	// webview CSP allows arbitrary script-src 'unsafe-inline' but blocks
	// extra origins; we explicitly allow js.stripe.com + the per-merchant
	// hostnames the SDK fetches at runtime.
	const csp = [
		`default-src 'none'`,
		`img-src https: data:`,
		`style-src 'unsafe-inline' https://js.stripe.com`,
		`script-src 'unsafe-inline' https://js.stripe.com https://m.stripe.network`,
		`connect-src https://api.stripe.com https://m.stripe.network`,
		`frame-src https://js.stripe.com https://hooks.stripe.com`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>Stripe Checkout</title>
<style>
:root { color-scheme: dark; }
body {
	margin: 0;
	padding: 24px;
	font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	background: #0f1115;
	color: #e5e7eb;
	font-size: 13px;
}
.wrap { max-width: 520px; margin: 0 auto; }
.header { padding-bottom: 16px; border-bottom: 1px solid #374151; margin-bottom: 20px; }
.title { font-size: 18px; font-weight: 600; color: #fff; }
.subtitle { font-size: 13px; color: #9ca3af; margin-top: 4px; }
.badge {
	display: inline-block;
	font-size: 10px;
	color: #fbbf24;
	background: rgba(251, 191, 36, 0.15);
	border: 1px solid rgba(251, 191, 36, 0.4);
	padding: 1px 6px;
	border-radius: 4px;
	margin-left: 8px;
	letter-spacing: 0.5px;
}
.card {
	background: #1f2937;
	border: 1px solid #374151;
	border-radius: 8px;
	padding: 18px;
}
#payment-element { min-height: 200px; }
.actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
}
button {
	font-family: inherit;
	font-size: 13px;
	border: 0;
	border-radius: 6px;
	cursor: pointer;
	padding: 8px 16px;
}
.cancel { background: #374151; color: #e5e7eb; }
.pay { background: #22c55e; color: #fff; font-weight: 600; padding: 8px 18px; }
.pay:disabled { background: #4b5563; cursor: not-allowed; }
.status { margin-top: 12px; font-size: 12px; min-height: 18px; }
.status.error { color: #fca5a5; }
.status.info { color: #9ca3af; }
.spinner {
	display: inline-block;
	width: 12px;
	height: 12px;
	border: 2px solid #22c55e;
	border-top-color: transparent;
	border-radius: 50%;
	animation: spin 1s linear infinite;
	vertical-align: -2px;
	margin-right: 6px;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="wrap">
	<div class="header">
		<div class="title">${escapeHtml(opts.appName)}${modeBadge}</div>
		<div class="subtitle">${escapeHtml(opts.planName)} &middot; ${amount}${intervalLabel}</div>
	</div>
	<div class="card">
		<div id="payment-element"></div>
		<div id="status" class="status info"></div>
		<div class="actions">
			<button id="cancel" class="cancel">Cancel</button>
			<button id="pay" class="pay" disabled>Pay ${amount}</button>
		</div>
	</div>
</div>
<script src="https://js.stripe.com/v3/"></script>
<script>
(function() {
	const vscode = acquireVsCodeApi();
	const status = document.getElementById('status');
	const payBtn = document.getElementById('pay');
	const cancelBtn = document.getElementById('cancel');

	function setStatus(msg, isError) {
		status.textContent = msg;
		status.className = 'status ' + (isError ? 'error' : 'info');
	}

	if (typeof Stripe !== 'function') {
		setStatus('Failed to load Stripe.js. Check your network or CSP.', true);
		return;
	}

	const stripe = Stripe(${JSON.stringify(opts.publishableKey)});
	const elements = stripe.elements({
		clientSecret: ${JSON.stringify(opts.clientSecret)},
		appearance: {
			theme: 'night',
			variables: {
				colorPrimary: '#22c55e',
				colorBackground: '#1f2937',
				colorText: '#e5e7eb',
				colorDanger: '#ef4444',
				borderRadius: '6px',
				fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
			},
		},
	});
	const paymentElement = elements.create('payment', { layout: 'tabs' });
	paymentElement.mount('#payment-element');
	paymentElement.on('ready', function() { payBtn.disabled = false; });
	paymentElement.on('change', function(e) {
		if (e.error) { setStatus(e.error.message, true); }
		else { setStatus('', false); }
	});

	cancelBtn.addEventListener('click', function() {
		vscode.postMessage({ type: 'cancel' });
	});

	payBtn.addEventListener('click', async function() {
		payBtn.disabled = true;
		setStatus('<span class="spinner"></span>Authorizing payment...', false);
		try {
			const result = await stripe.confirmPayment({
				elements: elements,
				confirmParams: {
					// Stripe requires a valid https return_url. vscode-webview://
					// is rejected, and the webview cannot navigate anyway, so we
					// supply a stable placeholder. With redirect:'if_required'
					// Stripe only navigates for ACH/iDEAL/Klarna etc. — card,
					// Apple Pay, Google Pay, Link stay inside the webview.
					return_url: 'https://app.ciyex.org/checkout-return',
				},
				redirect: 'if_required',
			});
			if (result.error) {
				setStatus(result.error.message || 'Payment failed.', true);
				payBtn.disabled = false;
				vscode.postMessage({ type: 'failed', message: result.error.message });
				return;
			}
			setStatus('Payment received. Activating extension...', false);
			vscode.postMessage({ type: 'paid' });
		} catch (err) {
			const msg = err && err.message ? err.message : 'Payment failed.';
			setStatus(msg, true);
			payBtn.disabled = false;
			vscode.postMessage({ type: 'failed', message: msg });
		}
	});
})();
</script>
</body>
</html>`;
}

function formatAmount(cents: number, currency: string): string {
	try {
		return (cents / 100).toLocaleString(undefined, {
			style: 'currency',
			currency: (currency || 'USD').toUpperCase(),
		});
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency}`;
	}
}

function escapeHtml(s: string): string {
	const map: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		'\'': '&#39;',
	};
	return s.replace(/[&<>"']/g, c => map[c]);
}
