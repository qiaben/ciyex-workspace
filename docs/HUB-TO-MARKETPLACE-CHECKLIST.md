# Ciyex Hub -> Marketplace Migration Checklist

## Overview

Migrate the Ciyex Hub (healthcare app marketplace at `/hub`) into VS Code's native Extensions sidebar, reusing the existing marketplace backend API (`ciyex-marketplace`) as a custom gallery service.

## Architecture

```
Ciyex Marketplace Backend (Java/Spring Boot)
    |
    | REST API (Gallery Query Protocol)
    |
Ciyex Workspace (VS Code fork)
    ├── Extensions Sidebar (native VS Code UI)
    │   ├── Browse / Search apps
    │   ├── App detail (README, screenshots, reviews)
    │   ├── Install / Uninstall
    │   └── Installed apps management
    ├── CiyexGalleryService (translates marketplace API -> VS Code gallery format)
    └── CiyexExtensionManagementService (manages installations via EHR API)
```

## Implementation Checklist

### Phase 1: Gallery Service Bridge
- [x] 1.1 Create `CiyexGalleryService` that implements `IExtensionGalleryService`
- [x] 1.2 Map Ciyex marketplace `/api/v1/apps` response to VS Code `IGalleryExtension` format
- [x] 1.3 Implement `query()` - search/filter apps from marketplace API
- [x] 1.4 Implement `getExtensions()` - fetch specific apps by slug
- [x] 1.5 Implement `getReadme()` / `getChangelog()` from app description
- [x] 1.6 Configure `product.json` extensionsGallery with marketplace URL
- [ ] 1.7 Handle app icons, screenshots as gallery extension assets

### Phase 2: Installation Bridge
- [ ] 2.1 Create `CiyexExtensionManagementService` bridging to `/api/app-installations`
- [ ] 2.2 Map install/uninstall to POST/DELETE `/api/app-installations`
- [ ] 2.3 Handle app configuration (configSchema -> VS Code settings)
- [ ] 2.4 Handle subscription creation on install (paid apps)
- [ ] 2.5 Show pricing info in extension detail view

### Phase 3: Reviews & Ratings
- [ ] 3.1 Add rating display to extension detail view
- [ ] 3.2 Add review list to extension detail
- [ ] 3.3 Add "Write Review" action
- [ ] 3.4 Show rating distribution

### Phase 4: Usage & Analytics
- [ ] 4.1 Track app_launch events when extension activates
- [ ] 4.2 Track plugin_render events for slot contributions
- [ ] 4.3 Add usage dashboard view in Extensions sidebar
- [ ] 4.4 Report usage to metering API

### Phase 5: Branding
- [ ] 5.1 Rename "Extensions" to "Hub" or "Ciyex Hub" in sidebar
- [ ] 5.2 Update marketplace icon to Ciyex branding
- [ ] 5.3 Add categories: Labs, Billing, Messaging, Clinical, etc.
- [ ] 5.4 Featured apps section
- [ ] 5.5 Compare apps feature

---

## API Mapping

| VS Code Gallery API | Ciyex Marketplace API |
|---|---|
| `POST /extensionquery` | `GET /api/v1/apps?q=&category=` |
| Extension ID | App slug |
| Publisher | Vendor |
| VSIX download | App installation (no VSIX) |
| Extension manifest | App configSchema + extensionPoints |
| Install count | subscriberCount |
| Rating | averageRating |
| Categories | category field |
