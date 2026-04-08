# Ciyex Hub Apps as VS Code Extensions — Design Document

> **Author:** Claude (Ciyex Engineering)
> **Date:** 2026-04-07
> **Status:** DRAFT

---

## 1. Executive Summary

Port Ciyex Hub marketplace apps (currently Java SDK microservices) to **TypeScript-based VS Code extensions** distributed via a **self-hosted Open VSX registry**. This enables apps to run natively inside Ciyex Workspace (our VS Code fork), eliminating separate frontends/backends for lightweight integrations and providing a unified extension marketplace experience.

---

## 2. Current Architecture (As-Is)

### 2.1 Ciyex Hub / Marketplace

```
┌─────────────────────────────────────────────────────────────┐
│                    CIYEX MARKETPLACE                         │
│  ciyex-marketplace (Spring Boot) + ciyex-marketplace-ui     │
│  App registry, vendor portal, subscriptions, billing        │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ twilio-sms   │ │ ciyex-rcm│ │ ciyex-tele-  │  ... more apps
│ (Java+SDK)   │ │ (Java)   │ │ health(Java) │
│ Port 8080    │ │ Port 8082│ │ Port 8088    │
│ PostgreSQL   │ │ PostgreSQL│ │ PostgreSQL   │
│ Twilio API   │ │ AWS/SFTP │ │ WebSocket    │
└──────────────┘ └──────────┘ └──────────────┘
        │             │             │
        └─────────────┼─────────────┘
                      ▼
        ┌─────────────────────────┐
        │  ciyex-platform-sdk     │
        │  (Java Maven artifact)  │
        │  Provider interfaces    │
        │  CiyexFilesClient       │
        │  Auth/JWT helpers       │
        └─────────────────────────┘
```

### 2.2 Java SDK Provider Interfaces

| Provider | Purpose | Example Impl |
|----------|---------|--------------|
| `ClinicalAiProvider` | Ambient AI, transcription, CDS | ask-ciya |
| `NotificationProvider` | SMS, Email, Voice, Push | twilio-sms |
| `PaymentProcessor` | Payments, refunds, tokenization | ciyex-patient-pay |
| `EligibilityProvider` | Insurance eligibility (EDI 270/271) | — |
| `ErxProvider` | E-prescribing, PDMP | — |
| `FaxProvider` | Fax send/receive | efax |
| `LabProvider` | Lab orders, results | — |
| `RcmEngine` | Claims, ERA, denials | ciyex-rcm |
| `RpmProvider` | Remote patient monitoring | — |
| `TelehealthProvider` | Video sessions, recording | ciyex-telehealth |

### 2.3 App Manifest (Marketplace Submission)

Apps currently declare via `CreateSubmissionRequest`:
- `appSlug`, `appName`, `version`, `category`, `description`
- `extensionPoints` (e.g., `ehr-sidebar`, `patient-chart`)
- `smartLaunchUrl`, `fhirResources`, `fhirScopes`
- `cdsHooksDiscoveryUrl`, `supportedHooks`
- `configSchema` (JSON Schema for app settings)
- `pricing` (FREE, FIXED, USAGE, TIERED, PERCENTAGE)

### 2.4 What Already Exists in Ciyex Workspace

- `product.json` has `extensionsGallery` pointing to `{ciyexApiUrl}/api/marketplace`
- `ciyexMarketplace.proxyThroughApi: true` — gallery requests proxy through ciyex-api
- `HUB-TO-MARKETPLACE-CHECKLIST.md` — Phase 1 (Gallery Service Bridge) complete
- `CiyexGalleryService` maps `/api/v1/apps` → VS Code `IGalleryExtension`

---

## 3. Target Architecture (To-Be)

### 3.1 Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  CIYEX WORKSPACE (VS Code fork)              │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ ext:sms  │  │ ext:rcm  │  │ ext:tele │  │ ext:ciya │   │
│  │ (TS/VSIX)│  │ (TS/VSIX)│  │ (TS/VSIX)│  │ (TS/VSIX)│   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │         │
│  ┌────┴──────────────┴──────────────┴──────────────┴─────┐  │
│  │           @ciyex/extension-sdk (npm package)           │  │
│  │  • CiyexApiClient (REST + auth)                        │  │
│  │  • FhirClient (FHIR R4 typed)                          │  │
│  │  • FilesClient (upload/download/presign)                │  │
│  │  • Provider interfaces (TS equivalents)                 │  │
│  │  • UI components (WebviewPanel helpers)                 │  │
│  │  • TreeView / StatusBar / Command helpers               │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│                   VS Code Extension API                      │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS
                            ▼
              ┌─────────────────────────────┐
              │  ciyex-api (API Gateway)     │
              │  /api/fhir-resource/*        │
              │  /api/files-proxy/*          │
              │  /api/marketplace/*          │
              │  /api/app-installations/*    │
              └─────────────────────────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
         FHIR Server    Keycloak     PostgreSQL
```

### 3.2 Extension Distribution

```
┌──────────────────────────────────────────────────┐
│         SELF-HOSTED OPEN VSX REGISTRY             │
│         (registry.ciyex.org)                      │
│                                                    │
│  Publisher: ciyex (verified)                       │
│  Publisher: vendor-abc (third-party)               │
│                                                    │
│  Extensions:                                       │
│  ├── ciyex.sms-notifications     v1.2.0  (.vsix)  │
│  ├── ciyex.rcm-billing           v2.0.1  (.vsix)  │
│  ├── ciyex.telehealth            v1.0.0  (.vsix)  │
│  ├── ciyex.ask-ciya              v3.1.0  (.vsix)  │
│  ├── ciyex.credentialing         v1.0.0  (.vsix)  │
│  ├── vendor-abc.lab-connect      v1.0.0  (.vsix)  │
│  └── vendor-xyz.rpm-monitor      v2.0.0  (.vsix)  │
└──────────────────────────────────────────────────┘
         ▲                          ▲
         │ vsce publish             │ GET /api/-/query
         │                          │
    Developer CLI              Ciyex Workspace
    (vsce / ovsx)              Extension Marketplace
```

---

## 4. TypeScript Extension SDK (`@ciyex/extension-sdk`)

### 4.1 Package Structure

```
@ciyex/extension-sdk/
├── src/
│   ├── index.ts                    # Public API exports
│   ├── client/
│   │   ├── CiyexApiClient.ts       # Authenticated REST client
│   │   ├── FhirClient.ts           # FHIR R4 typed client
│   │   └── FilesClient.ts          # File storage client
│   ├── providers/                   # Provider interface definitions
│   │   ├── ClinicalAiProvider.ts
│   │   ├── NotificationProvider.ts
│   │   ├── PaymentProcessor.ts
│   │   ├── EligibilityProvider.ts
│   │   ├── ErxProvider.ts
│   │   ├── FaxProvider.ts
│   │   ├── LabProvider.ts
│   │   ├── RcmEngine.ts
│   │   ├── RpmProvider.ts
│   │   └── TelehealthProvider.ts
│   ├── types/
│   │   ├── fhir-r4.ts              # FHIR R4 type definitions
│   │   ├── common.ts               # PatientRef, ProviderRef, Money, Address
│   │   └── marketplace.ts          # App, Vendor, Subscription types
│   ├── ui/
│   │   ├── WebviewHelper.ts        # Webview panel creation with CSP
│   │   ├── TreeDataProvider.ts     # Base tree view provider
│   │   ├── StatusBarHelper.ts      # Status bar item management
│   │   └── themes.ts               # VS Code color token helpers
│   └── auth/
│       ├── AuthProvider.ts          # Token acquisition from Ciyex auth
│       └── TokenStore.ts            # Secure token storage
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 Core API Surface

#### CiyexApiClient

```typescript
import * as vscode from 'vscode';

export class CiyexApiClient {
  constructor(context: vscode.ExtensionContext);

  /** Authenticated fetch — auto-injects Bearer token + X-Tenant-Name */
  fetch(path: string, init?: RequestInit): Promise<Response>;

  /** Typed GET */
  get<T>(path: string, params?: Record<string, string>): Promise<T>;

  /** Typed POST */
  post<T>(path: string, body: unknown): Promise<T>;

  /** Typed PUT */
  put<T>(path: string, body: unknown): Promise<T>;

  /** Typed DELETE */
  delete(path: string): Promise<void>;

  /** Get current auth state */
  readonly isAuthenticated: boolean;

  /** Get current org/tenant */
  readonly tenant: string;

  /** Listen for auth state changes */
  onDidChangeAuth: vscode.Event<boolean>;
}
```

#### FhirClient

```typescript
export class FhirClient {
  constructor(apiClient: CiyexApiClient);

  /** Search FHIR resources */
  search<T extends FhirResource>(
    resourceType: string,
    params?: Record<string, string>
  ): Promise<FhirBundle<T>>;

  /** Read single resource */
  read<T extends FhirResource>(
    resourceType: string, id: string
  ): Promise<T>;

  /** Create resource */
  create<T extends FhirResource>(
    resourceType: string, resource: T
  ): Promise<T>;

  /** Update resource */
  update<T extends FhirResource>(
    resourceType: string, id: string, resource: T
  ): Promise<T>;

  /** Paginated list via /api/fhir-resource/{tabKey} */
  list(tabKey: string, page?: number, size?: number): Promise<PagedResult>;
}
```

#### FilesClient

```typescript
export class FilesClient {
  constructor(apiClient: CiyexApiClient);

  upload(data: Uint8Array, contentType: string, key: string,
         meta: { orgId: string; service: string; refId: string; filename: string }
  ): Promise<void>;

  download(key: string): Promise<Uint8Array>;
  getPresignedUrl(key: string, expirySec?: number): Promise<string>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
```

### 4.3 Provider Interfaces (TypeScript Equivalents)

Each Java provider maps to a TS interface. Extensions implement these and register via the SDK:

```typescript
// NotificationProvider — TS equivalent of Java interface
export interface NotificationProvider {
  readonly vendorId: string;

  send(request: NotificationRequest): Promise<SendResult>;
  sendBatch(requests: NotificationRequest[]): Promise<BatchResult>;
  getDeliveryStatus(notificationId: string): Promise<DeliveryStatus>;
  listInbound(orgAlias: string, channel: string, limit: number, offset: number): Promise<InboundMessage[]>;
  testConnection(config: Record<string, string>): Promise<ConnectionStatus>;
}

// Registration — extensions register their provider
export function registerProvider(
  type: ProviderType,
  provider: unknown,
  context: vscode.ExtensionContext
): vscode.Disposable;
```

**Key difference from Java SDK:** In the TS extension model, providers that need a backend (like payment processing, claim submission) act as **thin clients** calling the existing Java microservices via REST. The extension handles UI + orchestration; the backend handles business logic.

### 4.4 Hybrid Architecture (Extension + Backend)

Not all Java apps can be fully ported to client-side TS. Three tiers:

| Tier | Description | Examples |
|------|-------------|----------|
| **Tier 1: Pure Extension** | 100% client-side TS. UI + API calls only. No backend needed. | SMS viewer, patient pay UI, RPM dashboard |
| **Tier 2: Extension + Existing Backend** | TS extension for UI, calls existing Java microservice for logic. | RCM (claim submission needs EDI), Telehealth (WebRTC signaling) |
| **Tier 3: Extension + New TS Backend** | TS extension + new Node.js/Deno service replacing Java. | Ask Ciya (LLM proxy), Fax (simple API proxy) |

```
Tier 1 (Pure):     [Extension] → [ciyex-api] → [FHIR/DB]
Tier 2 (Hybrid):   [Extension] → [Java Backend (existing)] → [External APIs]
Tier 3 (Full TS):  [Extension] → [Node.js Backend (new)] → [External APIs]
```

---

## 5. Extension Structure & Packaging

### 5.1 Standard Extension Layout

```
ciyex-sms-notifications/
├── package.json              # VS Code extension manifest
├── src/
│   ├── extension.ts          # activate() / deactivate()
│   ├── commands/
│   │   ├── sendSms.ts
│   │   └── viewConversation.ts
│   ├── views/
│   │   ├── SmsTreeProvider.ts      # Sidebar tree view
│   │   └── ConversationWebview.ts  # Webview panel
│   ├── providers/
│   │   └── TwilioProvider.ts       # NotificationProvider impl
│   └── test/
│       └── extension.test.ts
├── resources/
│   ├── icon.png              # 128x128 extension icon
│   └── webview/
│       ├── conversation.html
│       └── conversation.css
├── tsconfig.json
├── esbuild.config.mjs        # Bundle for VSIX
├── .vscodeignore
├── CHANGELOG.md
└── README.md
```

### 5.2 Extension package.json (Manifest)

```jsonc
{
  "name": "sms-notifications",
  "displayName": "SMS Notifications",
  "description": "Two-way SMS messaging for patient communication",
  "version": "1.2.0",
  "publisher": "ciyex",
  "icon": "resources/icon.png",
  "categories": ["Other"],
  "keywords": ["ciyex", "sms", "notifications", "twilio", "healthcare"],
  "engines": { "vscode": "^1.114.0" },

  // Ciyex-specific metadata (custom fields)
  "ciyex": {
    "appSlug": "sms-notifications",
    "category": "Communications",
    "fhirResources": ["Patient", "Communication"],
    "fhirScopes": "patient/Patient.read patient/Communication.write",
    "extensionPoints": ["ehr-sidebar", "patient-chart"],
    "configSchema": {
      "type": "object",
      "properties": {
        "twilioAccountSid": { "type": "string", "title": "Twilio Account SID" },
        "twilioAuthToken": { "type": "string", "title": "Twilio Auth Token", "format": "password" }
      },
      "required": ["twilioAccountSid", "twilioAuthToken"]
    },
    "pricing": {
      "model": "USAGE",
      "unitPrice": 0.01,
      "unit": "message"
    },
    "tier": 2,
    "backendUrl": "https://sms.apps.ciyex.com"
  },

  "main": "./out/extension.js",
  "extensionDependencies": ["ciyex.ciyex-platform-sdk"],

  "activationEvents": [
    "onView:ciyex.sms.conversations",
    "onCommand:ciyex.sms.send"
  ],

  "contributes": {
    "commands": [
      { "command": "ciyex.sms.send", "title": "Send SMS", "category": "Ciyex SMS" },
      { "command": "ciyex.sms.viewConversation", "title": "View Conversation", "category": "Ciyex SMS" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "ciyex-sms", "title": "SMS", "icon": "resources/sms-icon.svg" }
      ]
    },
    "views": {
      "ciyex-sms": [
        { "id": "ciyex.sms.conversations", "name": "Conversations" },
        { "id": "ciyex.sms.templates", "name": "Templates" }
      ]
    },
    "configuration": {
      "title": "Ciyex SMS",
      "properties": {
        "ciyex.sms.defaultCountryCode": {
          "type": "string",
          "default": "+1",
          "description": "Default country code for phone numbers"
        }
      }
    },
    "menus": {
      "view/item/context": [
        { "command": "ciyex.sms.send", "when": "view == ciyex.patients.list" }
      ]
    }
  }
}
```

### 5.3 Extension Activation

```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { CiyexApiClient, FhirClient, registerProvider } from '@ciyex/extension-sdk';
import { SmsTreeProvider } from './views/SmsTreeProvider';
import { TwilioProvider } from './providers/TwilioProvider';

export function activate(context: vscode.ExtensionContext) {
  const api = new CiyexApiClient(context);
  const fhir = new FhirClient(api);
  const provider = new TwilioProvider(api);

  // Register provider with SDK
  context.subscriptions.push(
    registerProvider('notification', provider, context)
  );

  // Register tree view
  const treeProvider = new SmsTreeProvider(api);
  vscode.window.registerTreeDataProvider('ciyex.sms.conversations', treeProvider);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('ciyex.sms.send', async (patientId?: string) => {
      // ... send SMS logic
    })
  );
}

export function deactivate() {}
```

---

## 6. Self-Hosted Open VSX Registry

### 6.1 Why Open VSX (not custom)

| Option | Pros | Cons |
|--------|------|------|
| **Open VSX (self-hosted)** | VS Code native protocol, `vsce` CLI compatible, proven at scale (Eclipse Foundation), full API | Requires Java/PostgreSQL deployment |
| **Custom REST API** | Full control, existing marketplace integration | Must implement VS Code gallery protocol, maintain compatibility |
| **Verdaccio (npm)** | Simple | Not VS Code compatible, no VSIX support |

**Decision: Self-hosted Open VSX** — it speaks the VS Code Marketplace protocol natively, so `product.json` just needs a URL change. Extensions install/update/search identically to the Microsoft marketplace.

### 6.2 Open VSX Server Setup

```yaml
# docker-compose.yml
services:
  openvsx-server:
    image: ghcr.io/eclipse/openvsx-server:latest
    ports:
      - "8100:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/openvsx
      SPRING_DATASOURCE_USERNAME: openvsx
      SPRING_DATASOURCE_PASSWORD: ${OPENVSX_DB_PASSWORD}
      OVSX_UPSTREAM_URL: ""                    # No upstream (fully self-hosted)
      OVSX_WEBUI_URL: https://marketplace.ciyex.org
      OVSX_ELASTICSEARCH_HOST: elasticsearch:9200
    depends_on:
      - postgres
      - elasticsearch

  openvsx-webui:
    image: ghcr.io/eclipse/openvsx-webui:latest
    ports:
      - "3100:3000"
    environment:
      OVSX_REGISTRY_URL: http://openvsx-server:8080

  postgres:
    image: postgres:16
    volumes:
      - openvsx-data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: openvsx
      POSTGRES_USER: openvsx
      POSTGRES_PASSWORD: ${OPENVSX_DB_PASSWORD}

  elasticsearch:
    image: elasticsearch:8.12.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
    volumes:
      - es-data:/usr/share/elasticsearch/data

volumes:
  openvsx-data:
  es-data:
```

### 6.3 Ciyex Workspace Configuration

```jsonc
// product.json — update extensionsGallery
{
  "extensionsGallery": {
    "serviceUrl": "https://marketplace.ciyex.org/vscode/gallery",
    "itemUrl": "https://marketplace.ciyex.org/vscode/item?itemName={publisher}.{name}",
    "resourceUrlTemplate": "https://marketplace.ciyex.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
    "controlUrl": "",
    "nlsBaseUrl": "",
    "publisherUrl": ""
  }
}
```

### 6.4 Publishing Workflow

```bash
# 1. Install tools
npm install -g @vscode/vsce ovsx

# 2. Create namespace (one-time)
ovsx create-namespace ciyex \
  --registry-url https://marketplace.ciyex.org \
  --pat $CIYEX_PUBLISH_TOKEN

# 3. Package extension
cd ciyex-sms-notifications
vsce package  # → ciyex-sms-notifications-1.2.0.vsix

# 4. Publish to Ciyex registry
ovsx publish ciyex-sms-notifications-1.2.0.vsix \
  --registry-url https://marketplace.ciyex.org \
  --pat $CIYEX_PUBLISH_TOKEN
```

### 6.5 CI/CD Pipeline

```yaml
# .github/workflows/publish-extension.yml
name: Publish Extension
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }

      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run compile

      # Package
      - run: npx vsce package
      
      # Publish to Ciyex Open VSX
      - run: npx ovsx publish *.vsix
          --registry-url https://marketplace.ciyex.org
          --pat ${{ secrets.CIYEX_PUBLISH_TOKEN }}
```

---

## 7. Paid/Free Extensions — Licensing Without a Marketplace Service

### 7.1 Architecture: Open VSX + Lightweight Licensing

**Kill the ciyex-marketplace service entirely.** Replace with:

1. **Open VSX** — stores/distributes all extensions (free and paid)
2. **Licensing table in ciyex-api** — 3 tables, ~200 lines of code
3. **Extension SDK** — checks entitlement at activation time
4. **Stripe** — handles payment (direct integration, no marketplace middleman)

```
┌─────────────────────────────────────────────────────────────┐
│  CIYEX WORKSPACE (VS Code fork)                              │
│                                                              │
│  Extensions Sidebar ──► Open VSX Registry                    │
│  (browse, search,        (stores ALL .vsix files,            │
│   install, update)        free + paid, no billing)           │
│                                                              │
│  On activate() ──────► ciyex-api /api/licensing/check        │
│  (SDK auto-checks)       │                                   │
│                          ├─ FREE → allow                     │
│                          ├─ PAID + valid license → allow     │
│                          └─ PAID + no license → show paywall │
│                                                              │
│  "Buy Now" button ───► Stripe Checkout Session               │
│  (in paywall UI)         │                                   │
│                          └─► Webhook → ciyex-api creates     │
│                                        license record        │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Extension Pricing Declaration

Pricing lives in the extension's `package.json` — **no separate service needed**:

```jsonc
{
  "name": "sms-notifications",
  "publisher": "ciyex",
  "ciyex": {
    "pricing": "free"
    // OR
    "pricing": {
      "model": "subscription",        // "free" | "one-time" | "subscription" | "usage"
      "plans": [
        {
          "id": "basic",
          "name": "Basic",
          "price": 29,                 // USD cents × 100 (i.e., $29/mo)
          "currency": "USD",
          "interval": "monthly",       // "monthly" | "yearly"
          "trialDays": 14,
          "features": ["Up to 500 SMS/month", "Templates"]
        },
        {
          "id": "pro",
          "name": "Pro",
          "price": 79,
          "currency": "USD",
          "interval": "monthly",
          "features": ["Unlimited SMS", "Templates", "Auto-reply", "Analytics"]
        }
      ],
      "stripeProductId": "prod_ABC123"  // Vendor's Stripe product
    }
  }
}
```

### 7.3 Database: 3 Tables in ciyex-api (No Separate Service)

Add to existing ciyex-api PostgreSQL — no new microservice:

```sql
-- 1. Extension licenses (who paid for what)
CREATE TABLE extension_licenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_alias       VARCHAR(100) NOT NULL,          -- tenant/practice
    extension_id    VARCHAR(200) NOT NULL,           -- "ciyex.sms-notifications"
    plan_id         VARCHAR(50),                     -- "basic" | "pro" | NULL (free)
    status          VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | expired | cancelled | trial
    stripe_sub_id   VARCHAR(100),                    -- Stripe subscription ID
    trial_ends_at   TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_alias, extension_id)
);

-- 2. Extension usage metering (for usage-based pricing)
CREATE TABLE extension_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_alias       VARCHAR(100) NOT NULL,
    extension_id    VARCHAR(200) NOT NULL,
    event_type      VARCHAR(50) NOT NULL,            -- "sms_sent" | "fax_sent" | "ai_query"
    count           INTEGER NOT NULL DEFAULT 1,
    recorded_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_usage_org_ext ON extension_usage(org_alias, extension_id, recorded_at);

-- 3. Vendor payouts (Stripe Connect)
CREATE TABLE extension_vendors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_name  VARCHAR(100) NOT NULL UNIQUE,    -- matches Open VSX publisher
    stripe_account  VARCHAR(100),                    -- Stripe Connect account ID
    payout_percent  INTEGER NOT NULL DEFAULT 80,     -- vendor gets 80%, platform gets 20%
    contact_email   VARCHAR(200),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.4 Licensing API (Add to ciyex-api, ~200 Lines)

```
# Check license (called by SDK on extension activate)
GET  /api/licensing/{extensionId}
     → { status: "active"|"trial"|"expired"|"none",
         plan: "pro", trialEndsAt: "...", features: [...] }

# Create checkout session (user clicks "Buy" in extension)
POST /api/licensing/{extensionId}/checkout
     ← { planId: "pro" }
     → { checkoutUrl: "https://checkout.stripe.com/..." }

# Stripe webhook (creates/updates license automatically)
POST /api/licensing/webhook/stripe
     ← Stripe event (checkout.session.completed, invoice.paid, subscription.cancelled)

# Admin: list all licenses for this org
GET  /api/licensing
     → [{ extensionId, plan, status, currentPeriodEnd }]

# Report usage (for usage-based billing)
POST /api/licensing/{extensionId}/usage
     ← { eventType: "sms_sent", count: 1 }
```

### 7.5 SDK Entitlement Check (Automatic)

Extensions don't write licensing code. The SDK handles it transparently:

```typescript
// @ciyex/extension-sdk — runs automatically in CiyexApiClient constructor

export class CiyexApiClient {
  constructor(context: vscode.ExtensionContext) {
    // ...auth setup...

    // Auto-check license on activation
    const pricing = context.extension.packageJSON.ciyex?.pricing;
    if (pricing && pricing !== 'free') {
      this._checkLicense(context);
    }
  }

  private async _checkLicense(context: vscode.ExtensionContext): Promise<void> {
    const extId = `${context.extension.packageJSON.publisher}.${context.extension.packageJSON.name}`;
    const pricing = context.extension.packageJSON.ciyex?.pricing;

    try {
      const license = await this.get<LicenseStatus>(`/api/licensing/${extId}`);

      if (license.status === 'active' || license.status === 'trial') {
        // Licensed — store features for gating
        this._features = new Set(license.features || []);
        return;
      }

      // Not licensed — show paywall
      this._showPaywall(extId, pricing, license);

    } catch {
      // API unreachable — grace period (allow 24h offline)
      const lastCheck = context.globalState.get<number>(`license.${extId}.lastValid`);
      if (lastCheck && Date.now() - lastCheck < 86400000) {
        return; // Grace period
      }
      this._showPaywall(extId, pricing, { status: 'none' });
    }
  }

  private _showPaywall(extId: string, pricing: PricingConfig, license: LicenseStatus): void {
    const plans = pricing.plans || [];
    const planNames = plans.map(p => `${p.name} — $${p.price}/mo`);

    const message = license.status === 'expired'
      ? `Your ${extId} subscription has expired.`
      : license.status === 'trial'
        ? `Your trial ends ${license.trialEndsAt}. Subscribe to continue.`
        : `${extId} requires a subscription.`;

    vscode.window.showInformationMessage(message, ...planNames, 'Not Now')
      .then(async choice => {
        const plan = plans.find(p => choice?.startsWith(p.name));
        if (plan) {
          // Open Stripe Checkout
          const { checkoutUrl } = await this.post<{ checkoutUrl: string }>(
            `/api/licensing/${extId}/checkout`,
            { planId: plan.id }
          );
          vscode.env.openExternal(vscode.Uri.parse(checkoutUrl));
        }
      });
  }

  /**
   * Extensions can check if a specific feature is licensed.
   * Useful for "Basic vs Pro" gating within a single extension.
   */
  hasFeature(feature: string): boolean {
    return this._features.has(feature) || this._features.has('*');
  }
}
```

### 7.6 Purchase Flow (User Experience)

```
User browses Extensions sidebar
        │
        ▼
Finds "SMS Notifications" (from Open VSX)
        │
        ▼
Clicks "Install" → extension installs normally (free download)
        │
        ▼
Extension activates → SDK calls GET /api/licensing/ciyex.sms-notifications
        │
        ├─ FREE extension → works immediately
        │
        ├─ PAID + has license → works immediately
        │
        └─ PAID + no license → shows paywall:
           ┌──────────────────────────────────────────────┐
           │  SMS Notifications requires a subscription.   │
           │                                                │
           │  [Basic — $29/mo]  [Pro — $79/mo]  [Not Now]  │
           └──────────────────────────────────────────────┘
                    │
                    ▼
           User clicks "Pro — $79/mo"
                    │
                    ▼
           SDK calls POST /api/licensing/ciyex.sms/checkout { planId: "pro" }
                    │
                    ▼
           ciyex-api creates Stripe Checkout Session
           (with platform fee split: 80% vendor / 20% Ciyex)
                    │
                    ▼
           Browser opens → Stripe Checkout page → user pays
                    │
                    ▼
           Stripe sends webhook → POST /api/licensing/webhook/stripe
                    │
                    ▼
           ciyex-api creates license record in extension_licenses
                    │
                    ▼
           Next time extension activates (or polls) → license active ✓
```

### 7.7 Vendor Payout (Stripe Connect)

```
Stripe Checkout ($79/mo)
        │
        ▼
Stripe Connect splits payment automatically:
  ├── Vendor (ciyex.sms publisher):  $63.20 (80%)
  └── Ciyex platform:                $15.80 (20%)

Configured via extension_vendors.payout_percent
Stripe handles all payouts, tax forms, compliance.
```

### 7.8 Feature Gating (Basic vs Pro Within One Extension)

Extensions can gate features without separate builds:

```typescript
// In extension code
export async function activate(context: vscode.ExtensionContext) {
  const api = new CiyexApiClient(context); // auto-checks license

  // Basic features — always available if licensed
  registerSendSmsCommand(api);
  registerConversationView(api);

  // Pro features — check at runtime
  if (api.hasFeature('Auto-reply')) {
    registerAutoReplySettings(api);
  }
  if (api.hasFeature('Analytics')) {
    registerAnalyticsDashboard(api);
  }
}
```

### 7.9 What Gets Killed vs Kept

| ciyex-marketplace Component | Fate | Replacement |
|----------------------------|------|-------------|
| App registry (apps table) | **KILL** | Open VSX registry |
| App search/browse | **KILL** | Open VSX search API |
| VSIX hosting/download | **KILL** | Open VSX file storage |
| Vendor portal (submissions) | **KILL** | `ovsx` CLI + CI/CD publish |
| Submission review queue | **KILL** | Open VSX admin + security scan hook |
| Subscriptions/billing | **KILL** | 3 tables in ciyex-api + Stripe |
| Vendor payouts | **KILL** | Stripe Connect (direct) |
| App credentials/config | **KEEP** | Move to ciyex-api (Section 8) |
| Reviews/ratings | **KILL** | Open VSX has built-in reviews |
| Usage metering | **SIMPLIFY** | 1 table in ciyex-api |
| App installation tracking | **SIMPLIFY** | License table = installation |
| Webhooks for vendors | **KILL** | Stripe webhooks replace all |
| Private catalogs | **DEFER** | Open VSX namespaces or later |
| BAA tracking | **KEEP** | Move to ciyex-api |

**Net result:** Delete `ciyex-marketplace` repo (Spring Boot + React). Replace with ~200 lines of licensing code in ciyex-api + 3 DB tables + Stripe.

---

## 8. Centralized Server-Side Extension Settings

### 8.1 Why Server-Side (Not Local settings.json)

| Concern | Local settings.json | Server-side (Ciyex API) |
|---------|--------------------|-----------------------|
| Multi-tenant (per-org config) | No — single flat file | Yes — scoped by orgAlias |
| Admin manages for all users | No — each user has own file | Yes — admin sets once, all users inherit |
| Credential security | Plaintext on disk | Vault-backed, encrypted at rest |
| Roaming across devices | No — tied to machine | Yes — fetched on login |
| HIPAA audit trail | No logging | Full audit log per change |
| Role-based access | No — user edits freely | Yes — admin vs. user scopes |
| Default values from vendor | Via JSON Schema `default` | Vendor sets defaults in manifest, org overrides |

### 8.2 Three-Layer Settings Model

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: USER PREFERENCES (local, non-sensitive)       │
│  Stored in: VS Code settings.json                       │
│  Example: UI preferences, column widths, sort order     │
│  Managed by: Individual user                            │
├─────────────────────────────────────────────────────────┤
│  Layer 2: ORG CONFIGURATION (server, per-tenant)        │
│  Stored in: ciyex-api → PostgreSQL                      │
│  Example: Default SMS template, billing rules, timezone │
│  Managed by: Practice admin                             │
│  API: PUT /api/app-installations/{slug}/config          │
├─────────────────────────────────────────────────────────┤
│  Layer 1: CREDENTIALS & SECRETS (server, Vault)         │
│  Stored in: ciyex-api → HashiCorp Vault                 │
│  Example: Twilio API key, Stripe secret, SFTP password  │
│  Managed by: Practice admin (write-only, never read)    │
│  API: POST /api/v1/practices/{org}/apps/{slug}/creds    │
└─────────────────────────────────────────────────────────┘
```

**Resolution order:** Layer 1 (secrets) → Layer 2 (org config) → Layer 3 (user prefs) → Manifest defaults

### 8.3 Config Schema in Extension Manifest

Extensions declare their settings schema in `package.json`. The schema drives both the server-side admin UI and local settings UI:

```jsonc
{
  "ciyex": {
    "configSchema": {
      "type": "object",
      "properties": {
        // Layer 1: Credentials (stored in Vault, never exposed to extension)
        "twilioAccountSid": {
          "type": "string",
          "title": "Twilio Account SID",
          "layer": "credential",
          "description": "Your Twilio account identifier"
        },
        "twilioAuthToken": {
          "type": "string",
          "title": "Twilio Auth Token",
          "layer": "credential",
          "format": "password"
        },

        // Layer 2: Org config (stored in DB, shared across users)
        "defaultFromNumber": {
          "type": "string",
          "title": "Default From Number",
          "layer": "org",
          "default": "+15551234567"
        },
        "messageRetentionDays": {
          "type": "integer",
          "title": "Message Retention (days)",
          "layer": "org",
          "default": 90,
          "minimum": 30,
          "maximum": 365
        },
        "autoReplyEnabled": {
          "type": "boolean",
          "title": "Enable Auto-Reply",
          "layer": "org",
          "default": false
        },
        "autoReplyMessage": {
          "type": "string",
          "title": "Auto-Reply Message",
          "layer": "org",
          "default": "Thank you for your message. We will respond shortly."
        }
      },
      "required": ["twilioAccountSid", "twilioAuthToken"]
    }
  },

  // Layer 3: User preferences (stored locally in VS Code settings.json)
  "contributes": {
    "configuration": {
      "title": "SMS Notifications",
      "properties": {
        "ciyex.sms.defaultCountryCode": {
          "type": "string",
          "default": "+1",
          "description": "Default country code for phone numbers"
        },
        "ciyex.sms.notificationSound": {
          "type": "boolean",
          "default": true,
          "description": "Play sound on incoming SMS"
        }
      }
    }
  }
}
```

### 8.4 SDK Settings API

```typescript
// @ciyex/extension-sdk — CiyexSettingsClient

export class CiyexSettingsClient {
  constructor(private api: CiyexApiClient, private appSlug: string);

  /**
   * Get merged org config (Layer 2).
   * Credentials (Layer 1) are NEVER returned to the extension.
   * The backend uses credentials internally when calling vendor APIs.
   */
  async getConfig(): Promise<Record<string, unknown>>;

  /**
   * Get a single config value with type safety.
   */
  async get<T>(key: string, defaultValue?: T): Promise<T>;

  /**
   * Update org config (requires admin role).
   * Validates against configSchema before saving.
   */
  async setConfig(config: Record<string, unknown>): Promise<void>;

  /**
   * Listen for config changes (server push via polling or WebSocket).
   * Fires when admin updates config for this org.
   */
  onDidChangeConfig: vscode.Event<Record<string, unknown>>;
}
```

**Usage in extension:**

```typescript
export async function activate(context: vscode.ExtensionContext) {
  const api = new CiyexApiClient(context);
  const settings = new CiyexSettingsClient(api, 'sms-notifications');

  // Read org config (server-side)
  const fromNumber = await settings.get<string>('defaultFromNumber', '+15551234567');
  const autoReply = await settings.get<boolean>('autoReplyEnabled', false);

  // Read user prefs (local settings.json)
  const countryCode = vscode.workspace.getConfiguration('ciyex.sms').get('defaultCountryCode', '+1');

  // React to admin config changes
  settings.onDidChangeConfig(config => {
    console.log('Admin updated config:', config);
    // Refresh UI with new settings
  });
}
```

### 8.5 Server-Side API Endpoints

```
# Org Configuration (Layer 2) — stored in PostgreSQL
GET    /api/app-installations/{appSlug}/config              → { config: {...} }
PUT    /api/app-installations/{appSlug}/config              ← { config: {...} }
                                                              (validates against configSchema)

# Credentials (Layer 1) — stored in HashiCorp Vault
POST   /api/v1/practices/{org}/apps/{appSlug}/credentials   ← { twilioAccountSid: "...", ... }
DELETE /api/v1/practices/{org}/apps/{appSlug}/credentials
POST   /api/v1/practices/{org}/apps/{appSlug}/credentials/test  → { status: "ok" | "error" }
                                                              (calls testConnection() on backend)

# Config Schema (read-only, from extension manifest)
GET    /api/v1/apps/{appSlug}/config-schema                 → { configSchema: {...} }

# Audit Log
GET    /api/v1/practices/{org}/apps/{appSlug}/config-history → [{ changedBy, changedAt, diff }]
```

### 8.6 Admin Settings UI

The admin configures extensions via a **Settings Webview** inside Ciyex Workspace:

```
┌─────────────────────────────────────────────────────────┐
│  ⚙ SMS Notifications — Settings                        │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  CREDENTIALS                                             │
│  ─────────────────────────────────────                   │
│  Twilio Account SID    [AC1234567890...    ]             │
│  Twilio Auth Token     [••••••••••••••••••  ]            │
│                        [Test Connection ✓]               │
│                                                          │
│  CONFIGURATION                                           │
│  ─────────────────────────────────────                   │
│  Default From Number   [+1 555 123 4567    ]             │
│  Message Retention     [90 days         ▼]               │
│  Auto-Reply            [✓] Enabled                       │
│  Auto-Reply Message    [Thank you for your...]           │
│                                                          │
│                        [Save Changes]                    │
│                                                          │
│  AUDIT LOG                                               │
│  ─────────────────────────────────────                   │
│  Apr 7, 2026  admin@clinic.com  Changed autoReply→true   │
│  Apr 1, 2026  admin@clinic.com  Updated credentials      │
│  Mar 15, 2026 admin@clinic.com  Initial setup            │
└─────────────────────────────────────────────────────────┘
```

This UI is rendered by the SDK's built-in settings command:

```typescript
// @ciyex/extension-sdk provides this command automatically
// when extension has configSchema in manifest
vscode.commands.registerCommand('ciyex.settings.openAppConfig', (appSlug: string) => {
  // Opens a webview panel with auto-generated form from configSchema
  // Reads/writes via /api/app-installations/{slug}/config
  // Credential fields use /api/v1/practices/{org}/apps/{slug}/credentials
});
```

### 8.7 Credential Isolation

**Critical security design:** Extensions never access raw credentials.

```
Extension code                  ciyex-api backend           Twilio API
     │                               │                         │
     │  api.post('/api/sms/send',    │                         │
     │    { to: '+1...', body: 'Hi'})│                         │
     │ ─────────────────────────►    │                         │
     │                               │  1. Look up org creds   │
     │                               │     from Vault          │
     │                               │  2. Initialize Twilio   │
     │                               │     client with creds   │
     │                               │  3. Call Twilio API      │
     │                               │ ───────────────────►    │
     │                               │ ◄───────────────────    │
     │  ◄─────────────────────────   │                         │
     │  { sid: 'SM123', status: 'sent' }                       │
```

The extension says "send this SMS" — the **backend** resolves credentials from Vault and makes the vendor API call. The extension never sees the Twilio auth token.

---

## 9. Porting Guide: Java SDK → TS Extension

### 8.1 App-by-App Migration Plan

| App | Tier | TS Extension Scope | Backend Status |
|-----|------|--------------------|----------------|
| **twilio-sms** | 2 | Conversation UI, send form, template mgr | Keep Java backend for webhooks |
| **ciyex-rcm** | 2 | Claims dashboard, denial viewer, coding UI | Keep Java for EDI 837/835 |
| **ciyex-telehealth** | 2 | Session launcher, waiting room UI | Keep Java for WebRTC signaling |
| **ask-ciya** | 2 | Chat panel, note generator UI | Keep Java for LLM proxy |
| **ciyex-patient-pay** | — | *(No migration — keep standalone)* | — |
| **efax** | 3 | Fax send/receive UI | Replace with Node.js proxy |
| **ciyex-comm** | 2 | Multi-channel inbox UI | Keep Java for delivery |

### 8.2 Interface Mapping: Java → TypeScript

```
Java                                    TypeScript
──────────────────────                  ──────────────────────
@Service                                vscode.ExtensionContext
@Autowired CiyexFilesClient             new FilesClient(apiClient)
@Autowired RestTemplate                 new CiyexApiClient(context)
implements NotificationProvider         implements NotificationProvider
@PostMapping("/api/sms/send")           vscode.commands.registerCommand()
JPA Repository                          FhirClient / CiyexApiClient
@Scheduled                              setInterval() / vscode.tasks
WebSocket (STOMP)                       WebSocket in webview
Thymeleaf / JSP                         Webview HTML/CSS/JS
application.yml                         package.json "contributes.configuration"
Spring Security                         @ciyex/extension-sdk AuthProvider
Vault credentials                       vscode.SecretStorage
```

### 8.3 Example Migration: twilio-sms

**Before (Java):**
```java
@Service
public class TwilioNotificationProvider implements NotificationProvider {
    @Autowired private TwilioRestClient twilioClient;
    
    @Override
    public SendResult send(NotificationRequest req) {
        Message message = Message.creator(
            new PhoneNumber(req.to()),
            new PhoneNumber(req.from()),
            req.body()
        ).create(twilioClient);
        return new SendResult(message.getSid(), "sent");
    }
}
```

**After (TypeScript Extension):**
```typescript
// Extension calls the existing Java backend via REST
export class TwilioProvider implements NotificationProvider {
  readonly vendorId = 'twilio';

  constructor(private api: CiyexApiClient) {}

  async send(request: NotificationRequest): Promise<SendResult> {
    // Call existing twilio-sms Java service
    return this.api.post<SendResult>('/api/sms/send', request);
  }

  async listInbound(orgAlias: string, channel: string, limit: number, offset: number) {
    return this.api.get<InboundMessage[]>(
      `/api/sms/inbound?org=${orgAlias}&limit=${limit}&offset=${offset}`
    );
  }
}
```

---

## 10. Vendor (Third-Party) Extension Development

### 9.1 Developer Experience

```bash
# Scaffold new extension
npx @ciyex/create-extension my-lab-integration

# Structure created:
my-lab-integration/
├── package.json          # Pre-configured with ciyex fields
├── src/extension.ts      # Starter with SDK imports
├── .vscodeignore
└── README.md

# Develop
cd my-lab-integration
npm install
npm run watch               # Live reload in Ciyex Workspace

# Test
npm run test

# Package & publish
npx vsce package
npx ovsx publish *.vsix --registry-url https://marketplace.ciyex.org --pat $TOKEN
```

### 9.2 Sandbox Environment

Vendors get sandbox access via the marketplace:
- Sandbox FHIR server with synthetic data
- Sandbox Keycloak realm for auth testing
- Usage metering in test mode (no billing)

### 9.3 Submission & Review

1. Vendor publishes `.vsix` to Open VSX
2. Marketplace webhook triggers security scan
3. Admin reviews in marketplace admin panel
4. Approved → extension becomes visible in Ciyex Workspace marketplace
5. Rejected → vendor notified with feedback

---

## 11. Security Considerations

### 10.1 Extension Sandboxing

VS Code extensions run in a **Node.js extension host** process — they have full Node.js API access. Mitigations:

| Threat | Mitigation |
|--------|------------|
| Data exfiltration | CSP on webviews, network audit logging |
| Credential theft | `vscode.SecretStorage` (OS keychain), never raw localStorage |
| Malicious code | Security scan on submission, code signing |
| Excessive permissions | `ciyex.fhirScopes` declaration + runtime enforcement |
| Supply chain attack | Lock `@ciyex/extension-sdk` version, verify publisher |

### 10.2 Auth Token Flow

```
Extension                      SDK                         ciyex-api
    │                           │                              │
    │  api.get('/patients')     │                              │
    │ ─────────────────────►    │                              │
    │                           │  getToken()                  │
    │                           │  (from SecretStorage         │
    │                           │   or localStorage)           │
    │                           │                              │
    │                           │  GET /patients               │
    │                           │  Authorization: Bearer xxx   │
    │                           │  X-Tenant-Name: org1         │
    │                           │ ────────────────────────►    │
    │                           │  ◄────────────────────────   │
    │  ◄─────────────────────   │                              │
    │  { data: [...] }          │                              │
```

Extensions **never see raw tokens** — the SDK handles auth injection.

### 10.3 HIPAA Compliance

- Extensions must declare FHIR scopes in manifest
- SDK enforces scope checks before API calls
- Audit log for all FHIR reads/writes (server-side)
- No PHI stored in extension `globalState` — only in secure storage
- BAA required for vendor publishers (tracked in marketplace)

---

## 12. Per-App Migration Plan

### 12.1 Migration Summary

| # | Current App | Extension Name | Tier | Pricing | Backend | Effort | Priority |
|---|-------------|---------------|------|---------|---------|--------|----------|
| 1 | ciyex-marketplace + UI | *(KILL)* | — | — | Delete entirely | 1 week | P0 |
| 2 | ciyex-platform-sdk | `ciyex.extension-sdk` | — | Free | npm package | 3 weeks | P0 |
| 3 | twilio-sms | `ciyex.sms-notifications` | 2 | $29/mo | Keep Java | 2 weeks | P1 |
| 4 | ask-ciya | `ciyex.ask-ciya` | 2 | $49/mo | Keep Java | 3 weeks | P1 |
| 5 | efax | `ciyex.efax` | 2 | $19/mo | Keep Java | 1 week | P2 |
| 6 | ciyex-comm | `ciyex.comm-hub` | 2 | $39/mo | Keep Java | 2 weeks | P2 |
| 7 | ciyex-rcm + UI | `ciyex.rcm` | 2 | $199/mo | Keep Java | 6 weeks | P2 |
| 8 | ciyex-telehealth | `ciyex.telehealth` | 2 | $99/mo | Keep Java | 3 weeks | P2 |
| 9 | ciyex-credentialing | `ciyex.credentialing` | 2 | $49/mo | Keep Java | 2 weeks | P3 |
| 10 | ciyex-patient-pay | *(NO MIGRATION)* | — | — | Keep as-is (standalone) | — | — |
| 11 | ciyex-portal-ui | *(NO MIGRATION)* | — | — | Keep as-is (standalone) | — | — |
| 12 | ciyex-ehr-ui | *(ABSORBED)* | — | — | Into Ciyex Workspace core | Ongoing | — |
| 13 | ciyex-rcm-ui | *(ABSORBED)* | — | — | Into `ciyex.rcm` extension | — | — |

---

### 12.2 App #1: ciyex-marketplace + ciyex-marketplace-ui → KILL

**Current:** Spring Boot microservice (27 migrations, 15+ tables) + Next.js UI
**Action:** Delete both repos entirely

**What replaces each function:**

| Marketplace Function | Replacement |
|---------------------|-------------|
| App catalog/search | Open VSX registry |
| App detail pages | Open VSX web UI |
| App submissions/review | `ovsx` CLI + security scan webhook |
| Subscriptions/billing | 3 tables in ciyex-api + Stripe (Section 7) |
| Vendor management | Open VSX publisher accounts |
| Vendor payouts | Stripe Connect (direct) |
| Reviews/ratings | Open VSX built-in |
| App credentials/config | Moved to ciyex-api (Section 8) |
| Usage metering | 1 table in ciyex-api |
| Webhooks for vendors | Stripe webhooks |
| BAA tracking | Moved to ciyex-api |
| Private catalogs | Open VSX namespaces (later) |

**Migration steps:**
1. Add 3 licensing tables to ciyex-api (Section 7.3)
2. Add ~200 lines licensing controller to ciyex-api
3. Move `app_credentials` table to ciyex-api
4. Move BAA table to ciyex-api
5. Set up Stripe Connect for vendor payouts
6. Deploy Open VSX registry
7. Update `product.json` gallery URLs
8. Delete `ciyex-marketplace` and `ciyex-marketplace-ui` repos

---

### 12.3 App #2: ciyex-platform-sdk → `@ciyex/extension-sdk` (npm)

**Current:** Java Maven library (`org.ciyex:ciyex-platform-sdk:0.1.2`)
**Target:** TypeScript npm package (`@ciyex/extension-sdk`)

**Interface mapping:**

| Java Interface | TS Equivalent | Methods |
|---------------|---------------|---------|
| `CiyexFilesClient` | `FilesClient` | upload, download, getPresignedUrl, exists, delete |
| `NotificationProvider` | `NotificationProvider` | send, sendBatch, getDeliveryStatus, listInbound, testConnection |
| `FaxProvider` | `FaxProvider` | sendFax, getStatus, listInbound, provisionNumber |
| `PaymentProcessor` | `PaymentProcessor` | createPayment, capture, refund, void, tokenize |
| `RcmEngine` | `RcmEngine` | scrubClaim, submitClaim, checkStatus, parseEra, autoPost, analyzeDenial |
| `ClinicalAiProvider` | `ClinicalAiProvider` | transcribe, generateNote, suggestCodes, queryCds, summarize |
| `EligibilityProvider` | `EligibilityProvider` | verify, verifyBatch, discoverCoverage, estimateCost |
| `ErxProvider` | `ErxProvider` | prescribe, checkInteractions, checkFormulary, queryPdmp |
| `LabProvider` | `LabProvider` | submitOrder, getResults, searchTests, searchLabs |
| `TelehealthProvider` | `TelehealthProvider` | createSession, generateJoinToken, getRecording |
| `RpmProvider` | `RpmProvider` | enrollPatient, getReadings, getAlerts, getBillingSummary |

**Additional TS-only classes:**
- `CiyexApiClient` — authenticated REST client (auto-injects Bearer + tenant)
- `FhirClient` — typed FHIR R4 search/read/create/update
- `CiyexSettingsClient` — server-side config read/write (Section 8)
- `WebviewHelper` — webview creation with CSP, theming
- `LicenseClient` — entitlement checking (Section 7)

**Deliverables:**
- npm package: `@ciyex/extension-sdk`
- Scaffolding CLI: `@ciyex/create-extension`
- Published also as VS Code extension: `ciyex.extension-sdk` (for runtime activation)

---

### 12.4 App #3: twilio-sms → `ciyex.sms-notifications`

**Current:** Spring Boot (1 migration, 2 tables, Twilio SDK)
**Tier:** 2 (Extension + keep Java backend)
**Pricing:** Subscription $29/mo or usage-based $0.01/msg

**Why keep backend:** Twilio webhooks require a public HTTP endpoint for delivery status callbacks. Extensions can't receive inbound webhooks.

**Extension scope (NEW — TypeScript):**

| Feature | Implementation |
|---------|---------------|
| Conversation list (sidebar tree) | `TreeDataProvider` calling `GET /api/sms/messages` |
| Send SMS form | Webview panel with patient picker, template selector |
| Message templates | CRUD via `GET/POST/PUT /api/sms/templates` |
| Delivery status badges | Poll `GET /api/sms/delivery-status/{sid}` |
| Inbound SMS notifications | Poll `GET /api/sms/inbound` + VS Code notification |
| Quick send from patient chart | Context menu: right-click patient → Send SMS |
| Bulk messaging | Webview with CSV upload → `POST /api/sms/send-batch` |

**Backend scope (KEEP — Java):**
- Twilio API calls (send, receive webhooks)
- Delivery status webhook receiver
- Message storage (PostgreSQL)
- Credential management (Twilio SID/token from Vault)

**Extension package.json (ciyex fields):**
```jsonc
{
  "ciyex": {
    "pricing": {
      "model": "subscription",
      "plans": [
        { "id": "basic", "name": "Basic", "price": 2900, "interval": "monthly",
          "features": ["500 SMS/month", "Templates", "Delivery tracking"] },
        { "id": "pro", "name": "Pro", "price": 7900, "interval": "monthly",
          "features": ["Unlimited SMS", "Templates", "Auto-reply", "Bulk send", "Analytics"] }
      ]
    },
    "configSchema": {
      "properties": {
        "twilioAccountSid": { "type": "string", "layer": "credential" },
        "twilioAuthToken": { "type": "string", "layer": "credential", "format": "password" },
        "defaultFromNumber": { "type": "string", "layer": "org" },
        "autoReplyEnabled": { "type": "boolean", "layer": "org", "default": false }
      }
    }
  }
}
```

---

### 12.5 App #4: ask-ciya → `ciyex.ask-ciya`

**Current:** Spring Boot (1 migration, 5 tables, AWS Bedrock)
**Tier:** 2 (Extension + keep Java backend)
**Pricing:** Subscription $49/mo (includes AI token budget)

**Why keep backend:** AWS Bedrock credentials must stay server-side. LLM calls are compute-intensive, must be rate-limited and metered centrally.

**Extension scope (NEW — TypeScript):**

| Feature | Implementation |
|---------|---------------|
| AI Chat panel | Webview panel (like VS Code Chat) calling `POST /api/ai/chat` |
| Clinical note generator | Command: select encounter → AI generates SOAP note |
| Coding suggestions | Inline suggestions in encounter form → `POST /api/ai/coding` |
| EOB parser | Drag-drop PDF → `POST /api/ai/eob-parse` → structured data |
| Insurance card scanner | Drag-drop image → `POST /api/ai/insurance-parse` |
| Denial analysis | Context menu on claim → `POST /api/ai/denial-analyze` |
| Token usage dashboard | Webview showing `GET /api/ai/usage` with charts |

**Backend scope (KEEP — Java):**
- AWS Bedrock/Ollama LLM calls
- PDF text extraction (PDFBox)
- Token counting and cost tracking
- Rate limiting per org
- Model configuration

---

### 12.7 App #6: efax → `ciyex.efax`

**Current:** Spring Boot (1 migration, 2 tables, eFax API)
**Tier:** 2 (Extension + keep Java backend)
**Pricing:** Subscription $19/mo

**Why keep backend:** eFax webhooks for inbound fax delivery require public endpoint.

**Extension scope (NEW — TypeScript):**

| Feature | Implementation |
|---------|---------------|
| Fax inbox (sidebar) | TreeView calling `GET /api/fax/messages?direction=inbound` |
| Fax outbox | TreeView calling `GET /api/fax/messages?direction=outbound` |
| Send fax form | Webview: recipient number, cover page, attach PDF |
| View received fax | Open PDF in VS Code editor tab |
| Delivery status | Badge on tree items, poll status endpoint |
| Number management | Settings webview for fax number provisioning |

**Backend scope (KEEP — Java):**
- eFax API calls (send/receive)
- Webhook receiver (inbound fax)
- PDF cover page generation
- Fax number provisioning

---

### 12.8 App #7: ciyex-comm → `ciyex.comm-hub`

**Current:** Spring Boot (2 migrations, 4 tables, Twilio + Telnyx + mail)
**Tier:** 2 (Extension + keep Java backend)
**Pricing:** Subscription $39/mo

**Extension scope (NEW — TypeScript):**

| Feature | Implementation |
|---------|---------------|
| Unified inbox (sidebar) | TreeView grouped by channel (SMS, Email, Fax, Push) |
| Compose message | Webview with channel selector, template picker, recipient search |
| Template manager | Webview CRUD for notification templates |
| Preference center | Webview for patient notification opt-in/out |
| Broadcast/bulk send | Webview with audience builder + scheduling |
| Delivery analytics | Webview with charts (sent, delivered, failed, opened) |

**Backend scope (KEEP — Java):**
- Multi-vendor delivery (Twilio, Telnyx, mail, fax)
- Template rendering (Thymeleaf)
- Delivery webhook processing
- Preference enforcement
- Queue management (Redis)

---

### 12.9 App #8: ciyex-rcm + ciyex-rcm-ui → `ciyex.rcm`

**Current:** Spring Boot (46 migrations, 50+ tables, AWS Bedrock, SFTP) + Next.js UI
**Tier:** 2 (Extension + keep Java backend) — **LARGEST migration**
**Pricing:** Subscription $199/mo

**Why keep backend:** EDI 837/835 processing, clearinghouse SFTP, AWS Bedrock for denial AI, 50+ tables of billing data. Cannot run client-side.

**Extension scope (NEW — replaces ciyex-rcm-ui entirely):**

| Feature | Implementation |
|---------|---------------|
| Claims dashboard | Webview with table (TanStack-like), filters, search |
| Claim detail/edit | Webview form with CPT/ICD/modifier pickers |
| Claim submission | Command: select claims → `POST /api/rcm/claims/submit` |
| ERA/835 viewer | Webview parsing ERA data into readable format |
| Payment posting | Webview with auto-post suggestions from AI |
| Denial management | TreeView sidebar + detail webview with appeal workflow |
| Eligibility check | Command from patient chart → `POST /api/rcm/eligibility` |
| Fee schedule editor | Webview table with bulk edit |
| Superbill templates | Webview CRUD editor |
| Credentialing dashboard | Webview with provider status tracking |
| Reports | Webview with Recharts (AR aging, collections, denial rate) |
| Coding assistant | Inline AI suggestions → `POST /api/ai/coding` |
| Biller leaderboard | Webview with gamification metrics |
| Statement generation | Command → `POST /api/rcm/statements/generate` → PDF |

**Backend scope (KEEP — Java):**
- EDI 837P/837I generation and submission
- ERA/835 parsing
- Clearinghouse SFTP communication
- Claim scrubbing (NCCI, MUE, LCD rules)
- Denial AI analysis (AWS Bedrock)
- Payment auto-posting logic
- All 50+ database tables
- Batch processing jobs

**Delete:** `ciyex-rcm-ui` repo after migration (all UI moves to extension webviews)

---

### 12.10 App #9: ciyex-telehealth → `ciyex.telehealth`

**Current:** Spring Boot (2 migrations, 3 tables, WebSocket, Redis)
**Tier:** 2 (Extension + keep Java backend)
**Pricing:** Subscription $99/mo

**Why keep backend:** WebRTC signaling requires server-side WebSocket. Recording storage needs server-side processing.

**Extension scope (NEW — TypeScript):**

| Feature | Implementation |
|---------|---------------|
| Session launcher | Command: start telehealth → opens webview with video |
| Video/audio UI | Webview with mediasoup-client (WebRTC) |
| Waiting room | Webview showing queue, patient info, admit button |
| In-session tools | Webview overlay: chat, screen share, clinical notes |
| Session history | TreeView sidebar with past sessions |
| Recording playback | Webview video player with presigned URL |
| Scheduling | Integration with calendar extension |

**Backend scope (KEEP — Java):**
- WebSocket signaling (STOMP)
- mediasoup SFU management
- Recording storage (CiyexFilesClient → S3)
- Session state (Redis)
- Clinical data capture

---

### 12.11 App #10: ciyex-credentialing → `ciyex.credentialing`

**Current:** Spring Boot (2 migrations, 5 tables)
**Tier:** 2 (Extension + keep Java backend)
**Pricing:** Subscription $49/mo

**Extension scope (NEW — TypeScript):**

| Feature | Implementation |
|---------|---------------|
| Provider list (sidebar) | TreeView with credentialing status badges |
| Provider detail | Webview form with demographics, licenses, education |
| Document upload | Drag-drop into webview → `POST /api/cred/documents` |
| Application workflow | Webview with step wizard (apply → review → approve) |
| Enrollment tracking | Webview table with payer enrollment status |
| Expiration alerts | VS Code notifications for expiring credentials |
| Reports | Webview: credentialing status by provider/payer |

**Backend scope (KEEP — Java):**
- Document storage and verification
- Workflow state machine
- PDF packet generation (credential packets, verification letters)
- Payer enrollment API calls

---

### 12.11 App #10: ciyex-ehr-ui → ABSORBED into Ciyex Workspace

**Current:** Next.js (React 19, TipTap, FullCalendar, mediasoup, etc.)
**Action:** NOT an extension. This is being rebuilt as native VS Code EditorPanes (already in progress).

**Already migrated:**
- Calendar → `calendarEditor.ts` (EditorPane)
- Patient Chart → `patientChartEditor.ts` (EditorPane)
- Encounter Form → `encounterFormEditor.ts` (EditorPane)
- Patient List → `patientListDataProvider.ts` (TreeView)
- Encounter List → `encounterListPane.ts` (ViewPane)
- Schedule Sidebar → `scheduleSidebarPane.ts` (ViewPane)

**Remaining to migrate:**
- Lab orders/results → future EditorPane
- Settings pages → future EditorPane
- User management → future EditorPane
- Developer tools → future EditorPane

**Delete:** `ciyex-ehr-ui` repo once all screens are migrated to native VS Code components.

---

## 13. Migration Timeline

```
Month 1 ─────────────────────────────────────────────────────
  Week 1-2: Open VSX registry setup + deployment
  Week 2-3: @ciyex/extension-sdk (CiyexApiClient, FhirClient, FilesClient)
  Week 3-4: Licensing tables + controller in ciyex-api + Stripe Connect
            @ciyex/create-extension scaffolding CLI
            Kill ciyex-marketplace + ciyex-marketplace-ui

Month 2 ─────────────────────────────────────────────────────
  Week 1-2: ciyex.sms-notifications (Tier 2)
  Week 3-4: ciyex.ask-ciya (Tier 2, chat panel + coding suggestions)

Month 3 ─────────────────────────────────────────────────────
  Week 1:   ciyex.efax (Tier 2)
  Week 2-3: ciyex.comm-hub (Tier 2, unified inbox)
  Week 3-4: ciyex.credentialing (Tier 2)

Month 4 ─────────────────────────────────────────────────────
  Week 1-3: ciyex.telehealth (Tier 2, WebRTC webview)

Month 5-6 ────────────────────────────────────────────────────
  Week 1-6: ciyex.rcm (Tier 2, LARGEST — claims, ERA, denials, reports)
            Delete ciyex-rcm-ui after all screens ported

Month 6+ ─────────────────────────────────────────────────────
  Vendor onboarding, third-party extension support
  Security scanning pipeline
  Production HA for Open VSX
  Monitoring + usage dashboards
```

### Migration scorecard

| Metric | Before | After |
|--------|--------|-------|
| Separate microservices | 10 (Java) + 5 (Next.js) = **15 repos** | 9 Java backends + **8 extensions** |
| Frontend repos | 5 (Next.js apps) | **2** (patient-pay + portal stay as-is) |
| Marketplace service | 1 Spring Boot + 1 Next.js | **0** (Open VSX + 3 tables) |
| Lines of infrastructure code | ~50K (marketplace) | ~200 (licensing in ciyex-api) |
| Developer onboarding time | Hours (Java SDK + Spring Boot) | Minutes (`npx @ciyex/create-extension`) |
| Extension install flow | Browse web → subscribe → configure → launch | Install in sidebar → paywall → done |

---

## 14. Open Questions

| # | Question | Options | Recommendation |
|---|----------|---------|----------------|
| 1 | Should extensions bundle their webview UIs or load from CDN? | Bundle / CDN | **Bundle** — offline support, version consistency |
| 2 | How to handle extension updates that require backend updates? | Version lock / Compatibility matrix | **Compatibility matrix** — extension declares min backend version in `ciyex.minBackendVersion` |
| 3 | How to handle the patient portal (patients don't use VS Code)? | Keep Next.js / Embed in extension | **Keep Next.js** for patient-facing; extension manages config only |
| 4 | Should vendor Java backends be containerized or shared-host? | Per-vendor container / Shared k8s | **Shared k8s** with namespace isolation |
| 5 | How to handle offline/disconnected mode? | Grace period / Full offline | **24h grace period** (license cached, features work offline) |
| 6 | Open VSX hosting: self-hosted or Eclipse Foundation? | Self-hosted / Managed | **Self-hosted** — full control over access, custom branding |

---

## 14. Success Metrics

| Metric | Target |
|--------|--------|
| Time to scaffold new extension | < 5 minutes |
| Extension install → first API call | < 30 seconds |
| VSIX size (typical extension) | < 5 MB |
| Open VSX search latency | < 200ms |
| Third-party vendor onboarding | < 1 day |
| Java apps fully ported to extensions | 7 apps in 6 months |
