# EHR UI Migration - Implementation Checklist

## Phase 1: Authentication & Shell (DONE)
- [x] Two-step login gate (email discover -> password)
- [x] Session management & lock screen (30 min idle, JWT refresh)
- [x] Server settings popup (API URL, Keycloak URL/Realm/ClientID)
- [x] Ciyex branding (no-text 3D knot logo, dark theme, bold buttons)
- [x] CORS fix (webSecurity: false for Electron)

## Phase 2: Navigation Framework (DONE)
- [x] CiyexApiService - authenticated fetch wrapper with tenant headers
- [x] CiyexPermissionService - 40+ ContextKeys for RBAC
- [x] CiyexMenuService - API-driven menus from /api/menus/ehr-sidebar
- [x] Hide Selection, Terminal, Run/Debug menus
- [x] Status bar: user name, practice/tenant, role
- [x] 6 EHR ViewContainers (Calendar, Patients, Clinical, Messaging, Billing, Reports)
- [x] Ciyex Hub replaces Extensions, welcome page branding
- [x] No-text logo everywhere (titlebar, welcome, banner, update tooltip)

## Phase 3: Core Screens (DONE)
- [x] Patient List ViewPane with live API data, colored avatar circles, DOB
- [x] Calendar WebviewPanel - appointments table
- [x] Patient Chart WebviewPanel - demographics card
- [x] New Patient / New Appointment placeholder webviews
- [x] Commands in Command Palette

## Phase 4: Clinical Features (DONE)
- [x] Encounters list (patient, type, status) - click opens encounter detail
- [x] Prescriptions list (patient, medication, status)
- [x] Immunizations list (patient, vaccine, status)
- [x] Care Plans list (patient, title, status)
- [x] Referrals list (patient, specialist, status)
- [x] GenericListPane: reusable ViewPane factory

## Phase 5: Communication & Billing (DONE)
- [x] Messaging inbox configured
- [x] Billing payments + claims configured
- [x] Reports dashboard configured

## Phase 6: Admin Settings (DONE)
- [x] Uses VS Code built-in settings gear (no duplicate)

## Phase 7: Advanced Features (DONE)
- [x] Patient search Cmd+Shift+K with QuickPick (search-as-you-type, debounce)
- [x] $(account) icon in search results
- [x] Selecting result opens Patient Chart webview

## Phase 8: Extended Features (DONE)
- [x] Encounter detail WebviewPanel (date, type, provider, status, reason)
- [x] Encounter click in Clinical sidebar opens detail
- [x] Document Upload command (placeholder)
- [x] SMART on FHIR App Launcher (lists installed apps from /api/app-installations)
- [x] Browse Ciyex Hub command (shows installed apps + marketplace link)

## Remaining for Future
- [ ] Dynamic encounter form editor (from /api/tab-field-config/encounter-form metadata)
- [ ] Notification badges on activity bar icons
- [ ] Multi-tab patient charts (open multiple patients simultaneously)
- [ ] Offline mode with local data sync
- [ ] Replace WebviewPanels with native editors for better performance
- [ ] Full gallery service bridge for VS Code Extensions UI integration
- [ ] CDS Hooks real-time integration at clinical decision points
- [ ] Keycloak SSO login flow (redirect-based, not just password)

## All Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Search Patient | Cmd+Shift+K | Quick patient search with autocomplete |
| Open Calendar | - | Today's appointments in webview editor |
| Open Patient Chart | - | Patient demographics (from patient list click) |
| Open Encounter | - | Encounter detail (from clinical sidebar click) |
| New Patient | - | Placeholder patient creation form |
| New Appointment | - | Placeholder appointment form |
| Upload Document | - | Placeholder document upload |
| Launch SMART App | - | Lists installed SMART on FHIR apps |
| Browse Ciyex Hub | - | Shows installed apps and marketplace |
| Show Patients | - | Opens Patients sidebar |
| Show Clinical | - | Opens Clinical sidebar |
| Show Calendar | - | Opens Calendar sidebar |

## All Files (17 source files)

```
src/vs/workbench/contrib/
├── ciyexAuth/browser/           (4 files - authentication)
│   ├── ciyexAuth.contribution.ts
│   ├── ciyexAuthGate.ts
│   ├── ciyexAuthGateContribution.ts
│   └── ciyexAuthService.ts
├── ciyexEhr/browser/            (11 files - EHR features)
│   ├── ciyexEhr.contribution.ts
│   ├── ciyexEhrContribution.ts
│   ├── ciyexApiService.ts
│   ├── ciyexPermissionService.ts
│   ├── ciyexMenuService.ts
│   ├── ciyexViewContainers.ts
│   ├── ciyexCommands.ts
│   ├── patientListPane.ts
│   ├── patientListDataProvider.ts
│   ├── patientSearch.ts
│   └── genericListPane.ts
└── ciyexHub/browser/            (1 file - marketplace stub)
    └── ciyexHub.contribution.ts
```
