/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ICiyexPaymentService = createDecorator<ICiyexPaymentService>('ciyexPaymentService');

/**
 * One payment gateway as registered by a built-in extension (e.g.
 * `ciyex-payment-stripe`). Adding a new gateway is a matter of shipping a
 * sibling extension that calls back into `ciyex.payment.registerGateway`
 * during its `activate()` — no workbench code change.
 */
export interface RegisteredGateway {
	readonly id: string;
	readonly displayName: string;
	/** Command the extension exposes that opens its checkout webview. */
	readonly checkoutCommand: string;
	/** Optional command that surfaces gateway-specific configuration. */
	readonly configureCommand?: string;
}

/**
 * Payload sent into `checkoutCommand`. The extension consumes this and
 * resolves with a `CheckoutResult`.
 */
export interface CheckoutRequest {
	appSlug: string;
	appName: string;
	pricingPlanId: string;
	planName: string;
	priceCents: number;
	currency: string;
	interval?: 'month' | 'year' | 'one_time';
	clientSecret?: string;
	authToken?: string;
	orgAlias?: string;
}

export interface CheckoutResult {
	status: 'success' | 'cancelled' | 'error';
	appSlug: string;
	message?: string;
}

export interface ICiyexPaymentService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeGateways: Event<void>;
	readonly gateways: readonly RegisteredGateway[];
	/** Called by the workbench command `ciyex.payment.registerGateway`. */
	registerGateway(g: RegisteredGateway): void;
	/** True when at least one gateway extension has registered. */
	hasGateway(): boolean;
	/** Pick the currently-active gateway. Falls back to the first registered. */
	getActiveGateway(): RegisteredGateway | undefined;
}

/**
 * Thin registry of payment gateway extensions. Lives in the workbench so
 * the gating UI (notifications, marketplace tile) can ask "is anything able
 * to take a payment?" before showing a buy button. Concrete payment logic
 * (Stripe.js, GPS SDK, Square SDK, ...) lives entirely inside the
 * corresponding extension's webview — this service never touches gateway
 * SDKs directly.
 */
export class CiyexPaymentService extends Disposable implements ICiyexPaymentService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeGateways = this._register(new Emitter<void>());
	readonly onDidChangeGateways: Event<void> = this._onDidChangeGateways.event;

	private readonly _gateways = new Map<string, RegisteredGateway>();

	get gateways(): readonly RegisteredGateway[] {
		return [...this._gateways.values()];
	}

	registerGateway(g: RegisteredGateway): void {
		if (!g || !g.id || !g.checkoutCommand) {
			return;
		}
		this._gateways.set(g.id, {
			id: g.id,
			displayName: g.displayName || g.id,
			checkoutCommand: g.checkoutCommand,
			configureCommand: g.configureCommand,
		});
		this._onDidChangeGateways.fire();
	}

	hasGateway(): boolean {
		return this._gateways.size > 0;
	}

	getActiveGateway(): RegisteredGateway | undefined {
		// Future: read a user preference for "preferred gateway" here.
		// Today we use insertion order which matches extension activation
		// order, so the Stripe extension wins when it's the only one.
		return this._gateways.values().next().value;
	}
}
