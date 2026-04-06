# EHR UI Migration - Implementation Checklist

## Phase 1: Authentication & Shell (DONE)
- [x] Two-step login gate (email discover -> password)
- [x] Session management & lock screen (30 min idle, JWT refresh)
- [x] Server settings popup (API URL, Keycloak URL/Realm/ClientID)
- [x] Ciyex branding (no-text 3D knot logo, dark theme, bold buttons)
- [x] CORS fix (webSecurity: false for Electron)
- [x] Keycloak SSO login (OAuth PKCE) with popup window for IDP buttons

## Phase 2: Navigation Framework (DONE)
- [x] CiyexApiService - authenticated fetch wrapper with tenant headers
- [x] CiyexPermissionService - 40+ ContextKeys for RBAC
- [x] CiyexMenuService - API-driven menus from /api/menus/ehr-sidebar
- [x] Hide Selection, Terminal, Run/Debug menus
- [x] Status bar: user name, practice/tenant, role
- [x] 6 EHR ViewContainers (Calendar, Patients, Clinical, Messaging, Billing, Reports)

## Phase 3: Core Screens (DONE)
- [x] Patient List with live API data, colored avatar circles, DOB
- [x] Calendar WebviewPanel - appointments table
- [x] Tabbed Patient Chart - 30+ tabs from /api/tab-field-config/layout
- [x] Patient demographics + encounters tabs with data
- [x] New Patient / New Appointment placeholders

## Phase 4: Clinical Features (DONE)
- [x] Encounters list (click opens encounter detail webview)
- [x] Prescriptions, Immunizations, Care Plans, Referrals lists
- [x] GenericListPane: reusable configurable list factory

## Phase 5-6: Communication, Billing, Settings (DONE)
- [x] Messaging, Payments, Claims, Reports views configured
- [x] Settings uses VS Code built-in gear

## Phase 7: Advanced Features (DONE)
- [x] Patient search Cmd+Shift+K (QuickPick, search-as-you-type, 300ms debounce)

## Phase 8: Extended Features (DONE)
- [x] Encounter detail WebviewPanel
- [x] Document Upload command (placeholder)
- [x] SMART on FHIR App Launcher
- [x] Browse Ciyex Hub (installed apps + marketplace)
- [x] CDS Hooks service (discovery, invocation, card events)
- [x] Keycloak SSO with OAuth PKCE popup flow

## Remaining for Future
- [ ] Dynamic encounter form editor (render fields from /api/tab-field-config metadata)
- [ ] Notification badges on activity bar icons
- [ ] Multi-tab patient charts (open multiple patients simultaneously)
- [ ] Offline mode with local data sync
- [ ] Replace WebviewPanels with native editors for better performance
- [ ] Full gallery service bridge for VS Code Extensions UI
- [ ] CDS card UI rendering in patient chart webview

## All Commands (12)

| Command | Shortcut | Description |
|---------|----------|-------------|
| Search Patient | Cmd+Shift+K | Quick patient search with autocomplete |
| Open Calendar | - | Today's appointments in editor tab |
| Open Patient Chart | - | Tabbed patient chart (from patient list click) |
| Open Encounter | - | Encounter detail (from clinical sidebar click) |
| New Patient | - | Patient creation form (placeholder) |
| New Appointment | - | Appointment form (placeholder) |
| Upload Document | - | Document upload (placeholder) |
| Launch SMART App | - | Lists installed SMART on FHIR apps |
| Browse Ciyex Hub | - | Shows installed apps and marketplace |
| Show Patients | - | Opens Patients sidebar |
| Show Clinical | - | Opens Clinical sidebar |
| Show Calendar | - | Opens Calendar sidebar |

## All Source Files (19)

```
src/vs/workbench/contrib/
├── ciyexAuth/browser/              (4 files)
│   ├── ciyexAuth.contribution.ts   # Registration
│   ├── ciyexAuthGate.ts            # Login overlay + IDP buttons
│   ├── ciyexAuthGateContribution.ts
│   └── ciyexAuthService.ts         # Auth + Keycloak PKCE
├── ciyexEhr/browser/               (13 files)
│   ├── ciyexEhr.contribution.ts    # Service + view registration
│   ├── ciyexEhrContribution.ts     # Permissions, menus, status bar
│   ├── ciyexApiService.ts          # Auth-wrapped fetch
│   ├── ciyexPermissionService.ts   # RBAC ContextKeys (40+)
│   ├── ciyexMenuService.ts         # API-driven menu registration
│   ├── ciyexViewContainers.ts      # 6 ViewContainers + GenericListPane configs
│   ├── ciyexCommands.ts            # Calendar, Patient Chart, Encounter, Hub, SMART
│   ├── patientListPane.ts          # Patient list with avatars
│   ├── patientListDataProvider.ts  # TreeView data provider (legacy)
│   ├── patientSearch.ts            # Cmd+Shift+K quick search
│   ├── genericListPane.ts          # Reusable list ViewPane factory
│   └── cdsHooksService.ts          # CDS Hooks discovery + invocation
└── ciyexHub/browser/               (1 file)
    └── ciyexHub.contribution.ts    # Marketplace stub
```
