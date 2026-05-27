# Ciyex Payment — Stripe

Stripe payment gateway extension for the Ciyex workbench. Provides in-app
checkout for paid Ciyex marketplace extensions (`ciyex-telehealth`,
`ciyex-erx`, `ciyex-rcm`, `ciyex-payment-gateway`, …) so the user never
leaves the workbench to complete a purchase.

## How it plugs in

On `activate()` this extension calls
`vscode.commands.executeCommand('ciyex.payment.registerGateway', { id: 'stripe', ... })`
to register itself with the workbench's payment gateway registry. When a
gated feature needs payment the workbench fires the `ciyex.payment.checkout`
command, which routes to this extension's webview-based checkout flow.

To add another gateway (Global Payments, Square, …) create a sibling
extension `ciyex-payment-gps`, implement the same registration handshake,
and it becomes user-selectable in the Extensions view.

## Payment methods supported

The Stripe Payment Element auto-enables every method the underlying
PaymentIntent allows: card, Apple Pay, Google Pay, Link, ACH bank debit,
and any redirect-based wallets the merchant account has enabled.

## Configuration

Settings (`Cmd+,` → search "Ciyex Payment"):

- `ciyex.payment.stripe.publishableKey` — `pk_test_…` / `pk_live_…`. Leave
  blank to fetch from the marketplace backend `/api/v1/config/payment-gateway`.
- `ciyex.payment.stripe.mode` — `TEST` (default) or `LIVE`.
- `ciyex.payment.stripe.marketplaceApiUrl` — override for the marketplace
  base URL when auto-derivation from the EHR API host fails.
