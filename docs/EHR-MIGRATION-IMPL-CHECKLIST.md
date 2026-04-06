# EHR UI Migration - Implementation Checklist

## Phase 1: Authentication & Shell (DONE)
- [x] Two-step login gate (email discover -> password)
- [x] Session management & lock screen (30 min idle, JWT refresh)
- [x] Server settings popup (API URL, Keycloak URL/Realm/ClientID)
- [x] Ciyex branding (no-text 3D knot logo, dark theme, VS Code blue buttons)
- [x] CORS fix (webSecurity: false for Electron)

## Phase 2: Navigation Framework (DONE)
- [x] CiyexApiService - authenticated fetch wrapper with tenant headers
- [x] CiyexPermissionService - 40+ ContextKeys (ciyex.perm.*, ciyex.fhir.*, ciyex.role.*)
- [x] CiyexMenuService - API-driven menus from /api/menus/ehr-sidebar
- [x] Hide Selection, Terminal, Run/Debug menus
- [x] Status bar: user name, practice/tenant, role
- [x] 6 EHR ViewContainers in Activity Bar (Calendar, Patients, Clinical, Messaging, Billing, Reports)
- [x] "Ciyex Hub" replaces Extensions, "Get Started with Ciyex Workspace" welcome page
- [x] No-text logo in titlebar, welcome page, update tooltip, banner

## Phase 3: Core Screens (DONE)
- [x] Patient List ViewPane with live API data, colored avatar circles, DOB
- [x] Calendar WebviewPanel - appointments table from /api/appointments
- [x] Patient Chart WebviewPanel - demographics from /api/patients/{id}
- [x] New Patient / New Appointment placeholder webviews
- [x] Commands: Open Calendar, New Patient, New Appointment, Open Patient Chart

## Phase 4: Clinical Features (DONE)
- [x] Encounters list from /api/encounters (patient, type, status)
- [x] Prescriptions list from /api/prescriptions (patient, medication, status)
- [x] Immunizations list from /api/immunizations (patient, vaccine, status)
- [x] Care Plans list from /api/care-plans (patient, title, status)
- [x] Referrals list from /api/referrals (patient, specialist, status)
- [x] GenericListPane: reusable ViewPane with configurable columns, icons, avatars

## Phase 5: Communication & Billing (DONE)
- [x] Messaging inbox configured (from /api/messages)
- [x] Billing payments configured (from /api/payments)
- [x] Billing claims configured (from /api/claims)
- [x] Reports dashboard configured (from /api/reports)

## Phase 6: Admin Settings (DONE)
- [x] Removed duplicate Settings ViewContainer (uses VS Code built-in gear)
- [x] Admin settings accessible via Command Palette

## Phase 7: Advanced Features (DONE)
- [x] Patient search Cmd+Shift+K with QuickPick (search-as-you-type, 300ms debounce)
- [x] Search results show name, DOB, age, gender, email, phone
- [x] Selecting result opens Patient Chart webview
- [x] Bold login buttons

## Phase 8: Remaining (TODO)
- [ ] Encounter editor WebviewPanel (dynamic form from /api/tab-field-config/encounter-form)
- [ ] Document scanning/upload
- [ ] Notification badges on activity bar icons
- [ ] Multi-tab patient charts
- [ ] Offline mode with local data sync
- [ ] Replace WebviewPanels with native editors
- [ ] SMART on FHIR app launcher
- [ ] CDS Hooks integration
- [ ] Hub/Marketplace gallery service bridge

## All Files

```
src/vs/workbench/contrib/
├── ciyexAuth/browser/
│   ├── ciyexAuth.contribution.ts
│   ├── ciyexAuthGate.ts
│   ├── ciyexAuthGateContribution.ts
│   └── ciyexAuthService.ts
├── ciyexEhr/browser/
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
└── ciyexHub/browser/
    └── ciyexHub.contribution.ts
```
