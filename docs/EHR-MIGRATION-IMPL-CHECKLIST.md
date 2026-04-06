# EHR UI Migration - Implementation Checklist

## Phase 1: Authentication & Shell (DONE)
- [x] Two-step login gate (email discover -> password)
- [x] Session management & lock screen (30 min idle, JWT refresh)
- [x] Server settings popup (API URL, Keycloak URL/Realm/ClientID)
- [x] Ciyex branding (no-text logo, dark theme, VS Code blue buttons)
- [x] CORS fix (webSecurity: false for Electron)
- [x] product.json defaultChatAgent fix

## Phase 2: Navigation Framework (DONE)
- [x] CiyexApiService - authenticated fetch wrapper with tenant headers
- [x] CiyexPermissionService - loads from /api/user/permissions, sets 40+ ContextKeys
  - [x] Permission categories: ciyex.perm.scheduling, ciyex.perm.demographics, etc.
  - [x] FHIR scopes: ciyex.fhir.read.Patient, ciyex.fhir.write.Appointment, etc.
  - [x] Role keys: ciyex.role.admin, ciyex.role.provider, etc.
- [x] CiyexMenuService - fetches menu tree from /api/menus/ehr-sidebar
  - [x] Registers Clinical, Scheduling, Billing top-level menus
  - [x] Dynamically populates from API response
  - [x] Permission-gated menu items via ContextKeys
- [x] Hide unwanted menus (Selection, Terminal, Run/Debug) via ciyex.showDevMenus
- [x] Status bar items: user name, practice/tenant, role
- [x] Welcome page: "Get Started with Ciyex Workspace"
- [x] Extensions sidebar renamed to "Ciyex Hub"
- [x] No-text logo in titlebar, welcome page, update tooltip, banner

### Phase 2 Known Issues
- [ ] Clinical/Scheduling/Billing menus not appearing on macOS native menu bar
      (empty submenus are hidden; need commands to be functional first)
- [ ] EHR ViewContainers not yet registered in Activity Bar
      (Calendar, Patients, Clinical, etc. need ViewPaneContainer implementations)

## Phase 3: Core Screens (TODO)

### 3.1 EHR ViewContainers in Activity Bar
- [ ] Calendar ViewContainer (scheduling icon)
- [ ] Patients ViewContainer (users icon)
- [ ] Clinical ViewContainer (stethoscope) - Labs, Rx, Immunizations
- [ ] Messaging ViewContainer (message-square) - Messages, Fax
- [ ] Billing ViewContainer (dollar-sign) - Payments, Claims
- [ ] Reports ViewContainer (bar-chart)
- [ ] Settings ViewContainer (gear) - admin only

### 3.2 Patient List
- [ ] TreeView in Patients ViewContainer
- [ ] Patient search (Cmd+K shortcut)
- [ ] Click patient -> opens Patient Chart editor

### 3.3 Calendar
- [ ] WebviewPanel with embedded calendar
- [ ] Opens as editor tab

### 3.4 Patient Chart
- [ ] WebviewPanel with tabbed layout
- [ ] Tabs from /api/tab-field-config/layout
- [ ] Dynamic form rendering (DynamicFormRenderer equivalent)

### 3.5 Encounter Editor
- [ ] WebviewPanel with dynamic form
- [ ] Sections from /api/tab-field-config/encounter-form

### 3.6 Appointments
- [ ] TreeView with today's appointments
- [ ] Create appointment command

## Phase 4: Clinical Features (TODO)
- [ ] Labs (TreeView + detail panel)
- [ ] Prescriptions
- [ ] Immunizations, Care Plans, Referrals
- [ ] Messaging (Panel view)
- [ ] Document Scanning

## Phase 5: Admin & Settings (TODO)
- [ ] Settings (native VS Code settings pattern)
- [ ] User Management
- [ ] Role/Permission Management
- [ ] Menu Configuration
- [ ] Layout Settings (tab/field config editor)

## Phase 6: Native Optimization (TODO)
- [ ] Replace WebviewPanels with native editors
- [ ] Keyboard shortcuts for common EHR actions
- [ ] Command Palette integration
- [ ] Offline mode with local data sync

## Files Created

```
src/vs/workbench/contrib/
├── ciyexAuth/browser/
│   ├── ciyexAuth.contribution.ts        # Auth gate registration
│   ├── ciyexAuthGate.ts                 # Login overlay UI (DOM-based, CSP-safe)
│   ├── ciyexAuthGateContribution.ts     # Workbench contribution
│   └── ciyexAuthService.ts             # Auth state, token mgmt, session expiry
├── ciyexEhr/browser/
│   ├── ciyexEhr.contribution.ts         # EHR service registration
│   ├── ciyexEhrContribution.ts          # Loads permissions/menus, status bar
│   ├── ciyexApiService.ts               # Auth-wrapped fetch with tenant headers
│   ├── ciyexPermissionService.ts        # RBAC ContextKeys from /api/user/permissions
│   └── ciyexMenuService.ts             # API-driven menu registration
└── ciyexHub/browser/
    └── ciyexHub.contribution.ts         # Marketplace stub (WIP)
```

## Modified Files

```
product.json                            # Ciyex branding, gallery config
package.json                            # Ciyex Workspace name
workbench.html                          # Trusted types whitelist
workbench.desktop.main.ts               # Import EHR contributions
menubarControl.ts                       # Hide Selection/Terminal menus
debug.contribution.ts                   # Hide Run menu
extensions.contribution.ts              # Rename to "Ciyex Hub"
gettingStartedContent.ts                # Welcome page title
windows.ts                             # webSecurity: false
titlebarpart.css                        # Ciyex logo
gettingStarted.css                      # Ciyex logo
updateTooltip.css                       # Ciyex logo
bannerpart.css                          # Ciyex logo
code-icon.svg                           # Ciyex brand icon
```
