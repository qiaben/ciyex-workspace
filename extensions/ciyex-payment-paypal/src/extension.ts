/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Payload the workbench sends when it triggers checkout. Mirrors
 * `CheckoutRequest` in the workbench-side ciyexPaymentService.ts.
 */
interface CheckoutRequest {
	appSlug: string;
	appName: string;
	pricingPlanId: string;
	planName: string;
	priceCents: number;
	currency: string;
	interval?: 'month' | 'year' | 'one_time';
	/** PayPal order id created server-side (ciyex-patient-pay / marketplace).
	 *  The PayPal Buttons confirm against this id. */
	clientSecret?: string;
	authToken?: string;
	orgAlias?: string;
}

interface CheckoutResult {
	status: 'success' | 'cancelled' | 'error';
	appSlug: string;
	message?: string;
}

interface GatewayRegistration {
	id: string;
	displayName: string;
	checkoutCommand: string;
	configureCommand?: string;
}

const GATEWAY_ID = 'paypal';
const CHECKOUT_COMMAND = 'ciyex-payment-paypal.checkout';
const CONFIGURE_COMMAND = 'ciyex-payment-paypal.configure';
const REGISTER_COMMAND = 'ciyex.payment.registerGateway';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(
		vscode.commands.registerCommand(CHECKOUT_COMMAND, async (request: CheckoutRequest | undefined) => {
			if (!request || !request.appSlug) {
				vscode.window.showWarningMessage('PayPal checkout was invoked without a purchase request.');
				return;
			}
			return runCheckout(request);
		}),
		vscode.commands.registerCommand(CONFIGURE_COMMAND, () => {
			vscode.commands.executeCommand('workbench.action.openSettings', 'ciyex.payment.paypal');
		}),
	);

	await registerWithWorkbench();
}

async function registerWithWorkbench(): Promise<void> {
	const registration: GatewayRegistration = {
		id: GATEWAY_ID,
		displayName: 'PayPal',
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
				console.warn('[ciyex-payment-paypal] registerGateway failed', err);
				return;
			}
		}
		await new Promise(r => setTimeout(r, 500));
	}
	console.warn('[ciyex-payment-paypal] workbench did not expose', REGISTER_COMMAND, '— PayPal gateway is loaded but unreachable.');
}

export function deactivate(): void { /* no-op */ }

async function runCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
	const cfg = vscode.workspace.getConfiguration('ciyex.payment.paypal');
	const clientId = (cfg.get<string>('clientId') || '').trim();
	const mode = cfg.get<'SANDBOX' | 'LIVE'>('mode') ?? 'SANDBOX';

	if (!clientId) {
		const choice = await vscode.window.showErrorMessage(
			'PayPal client id is not configured. Open settings to add it?',
			'Open Settings',
			'Cancel',
		);
		if (choice === 'Open Settings') {
			vscode.commands.executeCommand(CONFIGURE_COMMAND);
		}
		return { status: 'error', appSlug: request.appSlug, message: 'No PayPal client id configured.' };
	}
	if (!request.clientSecret) {
		const message = 'No PayPal order id on the request. The subscription/intent endpoint must return the order id as clientSecret.';
		vscode.window.showErrorMessage(message);
		return { status: 'error', appSlug: request.appSlug, message };
	}

	const panel = vscode.window.createWebviewPanel(
		'ciyexPaymentPaypalCheckout',
		`Checkout: ${request.appName}`,
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true },
	);

	panel.webview.html = renderCheckoutHtml({
		clientId,
		mode,
		orderId: request.clientSecret,
		appName: request.appName,
		planName: request.planName,
		priceCents: request.priceCents,
		currency: request.currency,
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
	clientId: string;
	mode: 'SANDBOX' | 'LIVE';
	orderId: string;
	appName: string;
	planName: string;
	priceCents: number;
	currency: string;
}

function renderCheckoutHtml(opts: RenderOptions): string {
	const amount = formatAmount(opts.priceCents, opts.currency);
	const modeBadge = opts.mode === 'SANDBOX' ? '<span class="badge">SANDBOX</span>' : '';
	const sdkUrl = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(opts.clientId)}&currency=${encodeURIComponent(opts.currency || 'USD')}`;

	const csp = [
		`default-src 'none'`,
		`img-src https: data:`,
		`style-src 'unsafe-inline' https://www.paypalobjects.com`,
		`script-src 'unsafe-inline' https://www.paypal.com https://www.paypalobjects.com`,
		`connect-src https://www.paypal.com https://www.sandbox.paypal.com https://api-m.paypal.com https://api-m.sandbox.paypal.com`,
		`frame-src https://www.paypal.com https://www.sandbox.paypal.com`,
	].join('; ');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>PayPal Checkout</title>
<style>
:root { color-scheme: dark; }
body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1115; color: #e5e7eb; font-size: 13px; }
.wrap { max-width: 520px; margin: 0 auto; }
.header { padding-bottom: 16px; border-bottom: 1px solid #374151; margin-bottom: 20px; }
.title { font-size: 18px; font-weight: 600; color: #fff; }
.subtitle { font-size: 13px; color: #9ca3af; margin-top: 4px; }
.badge { display: inline-block; font-size: 10px; color: #60a5fa; background: rgba(96, 165, 250, 0.15); border: 1px solid rgba(96, 165, 250, 0.4); padding: 1px 6px; border-radius: 4px; margin-left: 8px; letter-spacing: 0.5px; }
.card { background: #1f2937; border: 1px solid #374151; border-radius: 8px; padding: 18px; }
.status { margin-top: 12px; font-size: 12px; min-height: 18px; }
.status.error { color: #fca5a5; }
.status.info { color: #9ca3af; }
.actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.cancel { background: #374151; color: #e5e7eb; border: 0; border-radius: 6px; cursor: pointer; padding: 8px 16px; font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
	<div class="header">
		<div class="title">${escapeHtml(opts.appName)}${modeBadge}</div>
		<div class="subtitle">${escapeHtml(opts.planName)} &middot; ${amount}</div>
	</div>
	<div class="card">
		<div id="paypal-button-container"></div>
		<div id="status" class="status info">Loading PayPal…</div>
		<div class="actions"><button id="cancel" class="cancel">Cancel</button></div>
	</div>
</div>
<script src="${sdkUrl}"></script>
<script>
(function() {
	const vscode = acquireVsCodeApi();
	const status = document.getElementById('status');
	function setStatus(msg, isError) { status.textContent = msg; status.className = 'status ' + (isError ? 'error' : 'info'); }

	document.getElementById('cancel').addEventListener('click', function() { vscode.postMessage({ type: 'cancel' }); });

	if (typeof paypal === 'undefined') {
		setStatus('Failed to load the PayPal SDK. Check the client id, network or CSP.', true);
		return;
	}
	setStatus('', false);
	paypal.Buttons({
		// Order was created server-side; confirm against the existing id.
		createOrder: function() { return ${JSON.stringify(opts.orderId)}; },
		onApprove: function() {
			setStatus('Payment received. The gateway webhook will confirm…', false);
			vscode.postMessage({ type: 'paid' });
		},
		onCancel: function() { vscode.postMessage({ type: 'cancel' }); },
		onError: function(err) {
			const msg = (err && err.message) ? err.message : 'PayPal error.';
			setStatus(msg, true);
			vscode.postMessage({ type: 'failed', message: msg });
		}
	}).render('#paypal-button-container');
})();
</script>
</body>
</html>`;
}

function formatAmount(cents: number, currency: string): string {
	try {
		return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: (currency || 'USD').toUpperCase() });
	} catch {
		return `${(cents / 100).toFixed(2)} ${currency}`;
	}
}

function escapeHtml(s: string): string {
	const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' };
	return s.replace(/[&<>"']/g, c => map[c]);
}
