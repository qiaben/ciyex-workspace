# EHR UI Migration - Implementation Checklist

## Phase 1: Authentication & Shell (DONE)
- [x] Two-step login gate (email discover -> password)
- [x] Session management & lock screen (30 min idle, JWT refresh)
- [x] Server settings popup (API URL, Keycloak URL/Realm/ClientID)
- [x] Ciyex branding (no-text 3D knot logo, dark theme, VS Code blue buttons)
- [x] CORS fix (webSecurity: false for Electron)
- [x] product.json defaultChatAgent fix

## Phase 2: Navigation Framework (DONE)
- [x] CiyexApiService - authenticated fetch wrapper with tenant headers
- [x] CiyexPermissionService - loads from /api/user/permissions, sets 40+ ContextKeys
- [x] CiyexMenuService - fetches menu tree from /api/menus/ehr-sidebar
- [x] Registers Clinical, Scheduling, Billing top-level menus dynamically
- [x] Hide Selection, Terminal, Run/Debug menus (ciyex.showDevMenus gate)
- [x] Status bar: user name, practice/tenant, role
- [x] Welcome page: "Get Started with Ciyex Workspace"
- [x] Extensions sidebar renamed to "Ciyex Hub"
- [x] No-text logo in titlebar, welcome page, update tooltip, banner
- [x] 7 EHR ViewContainers in Activity Bar with RBAC gates

## Phase 3: Core Screens (DONE)
- [x] Patient List ViewPane with live API data from /api/patients
- [x] Colored avatar circles with initials (name-hash unique colors)
- [x] DOB, age, gender displayed per patient row
- [x] Calendar WebviewPanel - opens as editor tab with appointments table
- [x] Patient Chart WebviewPanel - demographics card from /api/patients/{id}
- [x] New Patient / New Appointment placeholder webviews
- [x] Commands in Command Palette: Open Calendar, New Patient, New Appointment
- [x] Patient click triggers ciyex.openPatientChart command
- [x] Fixed service accessor timing (get services before await)

## Phase 4: Clinical Features (IN PROGRESS)
- [ ] Encounter list in Clinical sidebar (from /api/encounters or /api/fhir/Encounter)
- [ ] Encounter editor WebviewPanel (dynamic form from /api/tab-field-config/encounter-form)
- [ ] Lab Orders list in Clinical sidebar
- [ ] Lab Order detail WebviewPanel
- [ ] Prescriptions list
- [ ] Immunizations list
- [ ] Care Plans list
- [ ] Referrals list
- [ ] Document scanning/upload

## Phase 5: Communication & Billing
- [ ] Messaging inbox TreeView/ViewPane
- [ ] Message compose WebviewPanel
- [ ] Fax list
- [ ] Notifications panel
- [ ] Payments list in Billing sidebar
- [ ] Claims list
- [ ] Payment detail WebviewPanel

## Phase 6: Admin & Settings
- [ ] User Management TreeView + detail WebviewPanel
- [ ] Roles & Permissions editor
- [ ] Menu Configuration editor (drag-drop)
- [ ] Layout Settings editor (tab/field config)
- [ ] Encounter Settings editor
- [ ] Calendar Colors settings
- [ ] Portal Settings

## Phase 7: Advanced Features
- [ ] Patient search (Cmd+K global shortcut)
- [ ] Keyboard shortcuts for common EHR actions
- [ ] Command Palette integration for all EHR commands
- [ ] Notification badges on activity bar icons
- [ ] Multi-tab patient charts (open multiple patients)
- [ ] Offline mode with local data sync
- [ ] Replace WebviewPanels with native editors where possible
- [ ] SMART on FHIR app launcher integration
- [ ] CDS Hooks integration

## Phase 8: Hub/Marketplace
- [ ] Gallery service bridge (Ciyex marketplace API -> VS Code gallery format)
- [ ] App installation/uninstallation via /api/app-installations
- [ ] App reviews and ratings display
- [ ] Usage tracking and analytics
- [ ] Featured apps section

## Files Created

```
src/vs/workbench/contrib/
├── ciyexAuth/browser/
│   ├── ciyexAuth.contribution.ts
│   ├── ciyexAuthGate.ts              # Login overlay (DOM-based, CSP-safe)
│   ├── ciyexAuthGateContribution.ts
│   └── ciyexAuthService.ts           # Auth state, tokens, session
├── ciyexEhr/browser/
│   ├── ciyexEhr.contribution.ts      # Service + view registration
│   ├── ciyexEhrContribution.ts       # Permissions, menus, status bar
│   ├── ciyexApiService.ts            # Auth-wrapped fetch
│   ├── ciyexPermissionService.ts     # RBAC ContextKeys
│   ├── ciyexMenuService.ts           # API-driven menu registration
│   ├── ciyexViewContainers.ts        # 7 EHR ViewContainers + views
│   ├── ciyexCommands.ts              # Calendar, Patient Chart, New Patient/Appointment
│   ├── patientListPane.ts            # Patient list ViewPane with API data
│   └── patientListDataProvider.ts    # TreeView data provider (unused, replaced by ViewPane)
└── ciyexHub/browser/
    └── ciyexHub.contribution.ts      # Marketplace stub (WIP)
```
