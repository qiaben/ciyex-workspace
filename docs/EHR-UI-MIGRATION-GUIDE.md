# Ciyex EHR UI to Ciyex Workspace Migration Guide

This document describes how to migrate the Ciyex EHR UI (Next.js web app) screens, navigation, and menus into Ciyex Workspace (VS Code fork) using native VS Code UI patterns.

## Architecture Overview

| EHR UI (Web) | Ciyex Workspace (Desktop) |
|---|---|
| React components | VS Code ViewPanes (TypeScript) |
| Next.js routing (`/patients`, `/calendar`) | ViewContainer + TreeView/WebviewPanel |
| AppSidebar (Tailwind CSS) | Activity Bar + Sidebar ViewContainers |
| AppHeader (top bar) | Title Bar + Status Bar |
| MenuContext (API-driven) | MenuRegistry + ContextKeys |
| PermissionContext (RBAC) | Custom ContextKeys per permission |
| Tailwind CSS styling | VS Code theme tokens + CSS variables |

---

## 1. Sidebar Menu Migration

### EHR UI Sidebar Structure
The EHR sidebar is a hierarchical tree fetched from `/api/menus/ehr-sidebar`:

```
Calendar          -> /calendar
Appointments      -> /appointments
Patients          -> /patients
  New Patient     -> /patients/new
  Claim Mgmt     -> /patients/claim-management
Encounters        -> /all-encounters
Prescriptions     -> /prescriptions
Labs              -> /labs
  Lab Orders      -> /labs/orders
  Lab Results     -> /labs/results
Immunizations     -> /immunizations
Care Plans        -> /care-plans
Referrals         -> /referrals
Messaging         -> /messaging
Payments          -> /payments
Reports           -> /reports
Inventory         -> /inventory-management
Settings          -> /settings
  User Mgmt      -> /settings/user-management
  Roles           -> /settings/roles-permissions
  Menu Config     -> /settings/menu-configuration
Hub               -> /hub
```

### VS Code Mapping

Each top-level EHR menu group becomes a **ViewContainer** in the Activity Bar. Each sub-item becomes a **View** or **TreeView** within that container.

#### Step 1: Register View Containers (Activity Bar Icons)

Create `src/vs/workbench/contrib/ciyexEhr/browser/ciyexEhr.contribution.ts`:

```typescript
import { ViewContainerLocation } from '../../../common/views.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions, IViewContainersRegistry } from '../../../common/views.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { localize2 } from '../../../../nls.js';

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);

// Example: Register "Patients" view container
export const PATIENTS_CONTAINER = viewContainerRegistry.registerViewContainer({
    id: 'ciyex.patients',
    title: localize2('patients', "Patients"),
    ctorDescriptor: new SyncDescriptor(ViewPaneContainer, ['ciyex.patients']),
    icon: Codicon.person,    // or custom ThemeIcon
    order: 3,
}, ViewContainerLocation.Sidebar);

// Repeat for: Calendar, Appointments, Labs, Settings, etc.
```

#### Step 2: Register Views Within Containers

```typescript
import { IViewsRegistry, Extensions as ViewExtensions } from '../../../common/views.js';

const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

viewsRegistry.registerViews([
    {
        id: 'ciyex.patients.list',
        name: localize2('patientList', "Patient List"),
        ctorDescriptor: new SyncDescriptor(PatientListViewPane),
        when: ContextKeyExpr.has('ciyex.authenticated'),
    },
    {
        id: 'ciyex.patients.search',
        name: localize2('patientSearch', "Search"),
        ctorDescriptor: new SyncDescriptor(PatientSearchViewPane),
    },
], PATIENTS_CONTAINER);
```

#### Step 3: Implement Views as WebviewPanels

For complex EHR screens (patient chart, calendar, encounters), use **WebviewPanel** to embed the existing React components:

```typescript
class PatientListViewPane extends ViewPane {
    protected override renderBody(container: HTMLElement): void {
        const webview = this._register(
            this.webviewService.createWebviewOverlay({
                contentOptions: {
                    allowScripts: true,
                    localResourceRoots: [/* ... */],
                },
            })
        );
        // Load the React component via a local HTML file or inline
        webview.setHtml(this.getPatientListHtml());
        container.appendChild(webview.container!);
    }
}
```

### Recommended Activity Bar Layout

| Icon | ID | EHR Screens | VS Code Equivalent |
|---|---|---|---|
| Calendar | `ciyex.calendar` | Calendar, Appointments | Custom ViewContainer |
| Users | `ciyex.patients` | Patients, Encounters | Custom ViewContainer |
| Flask | `ciyex.clinical` | Labs, Prescriptions, Immunizations, Care Plans | Custom ViewContainer |
| MessageSquare | `ciyex.messaging` | Messaging, Fax, Notifications | Custom ViewContainer |
| DollarSign | `ciyex.billing` | Payments, Claims | Custom ViewContainer |
| BarChart | `ciyex.reports` | Reports, Analytics | Custom ViewContainer |
| Package | `ciyex.inventory` | Inventory Management | Custom ViewContainer |
| Settings | `ciyex.settings` | Settings, User Mgmt, Roles | Custom ViewContainer |
| Store | `ciyex.hub` | Marketplace/Hub | Custom ViewContainer |
| Code | `ciyex.developer` | Developer Portal | Keep VS Code's Explorer |

---

## 2. Main Menu Migration

### EHR UI Header Actions
The EHR top header has:
- Patient search (Cmd+K)
- + Patient button
- + Appointment button
- Notifications dropdown
- User dropdown (profile, sign out, practice switch)

### VS Code Menu Mapping

#### Remove Unwanted Default Menus

In `src/vs/workbench/contrib/ciyexEhr/browser/ciyexMenus.ts`:

```typescript
// Hide default menus that aren't relevant for EHR
// Use 'when' clause with a context key that's never true

// Option 1: Override menu visibility via ContextKeys
// Set a context key 'ciyex.ehrMode' = true at startup
// Then conditionally hide menus:

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
    submenu: MenuId.MenubarTerminalMenu,
    title: { value: 'Terminal', original: 'Terminal' },
    when: ContextKeyExpr.has('ciyex.showDevMenus'), // Hidden unless dev mode
    order: 7
});
```

#### Add EHR-Specific Menus

```typescript
// Register top-level "Clinical" menu
const MenubarClinicalMenu = new MenuId('MenubarClinicalMenu');

MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
    submenu: MenubarClinicalMenu,
    title: { value: 'Clinical', original: 'Clinical', mnemonicTitle: '&&Clinical' },
    order: 3,
});

// Add items to Clinical menu
MenuRegistry.appendMenuItem(MenubarClinicalMenu, {
    command: { id: 'ciyex.openPatients', title: 'Patients' },
    group: 'patients',
    order: 1,
});

MenuRegistry.appendMenuItem(MenubarClinicalMenu, {
    command: { id: 'ciyex.openEncounters', title: 'Encounters' },
    group: 'patients',
    order: 2,
});

MenuRegistry.appendMenuItem(MenubarClinicalMenu, {
    command: { id: 'ciyex.openPrescriptions', title: 'Prescriptions' },
    group: 'clinical',
    order: 3,
});
```

#### Recommended Menu Bar Structure

| Menu | Items | Notes |
|---|---|---|
| **File** | New Patient, New Appointment, New Encounter, Open Folder, Preferences | Keep standard items, add EHR actions |
| **Edit** | Keep as-is | Standard editing |
| **Clinical** | Patients, Encounters, Prescriptions, Labs, Immunizations, Care Plans, Referrals | NEW - main EHR menu |
| **Scheduling** | Calendar, Appointments, Recall | NEW |
| **Billing** | Payments, Claims, Authorizations | NEW |
| **View** | Keep + add EHR views | Standard + custom panels |
| **Go** | Keep as-is | Navigation |
| **Help** | Keep + Ciyex docs | Standard help |

#### Menus to Remove/Hide

These VS Code menus are not relevant for an EHR workspace:

```typescript
// Hide by setting 'when' to false or removing registrations:
// - Terminal menu (unless needed for dev mode)
// - Selection menu (code-specific)
// - Run menu (debugging)
// - Source Control menu (git - keep for dev mode only)

// In product.json, you can disable features:
{
    "extensionEnabledApiProposals": {},
    // Remove terminal, debug from default layout
}
```

---

## 3. Role-Based Menu Visibility (RBAC)

### EHR Permission Categories

```
scheduling       - Calendar, Appointments
demographics     - Patients
chart            - Encounters, Care Plans, Referrals, CDS, Consents
rx               - Prescriptions, Immunizations
orders           - Lab Orders, Lab Results
documents        - Document Scanning
messaging        - Messaging, Notifications, Fax
billing          - Payments, Claims
reports          - Reports
admin            - Settings, User Management, Roles, Audit Log
```

### VS Code ContextKey Mapping

Register permission-based context keys after login:

```typescript
// In CiyexAuthService, after successful login:
private _setPermissionContextKeys(permissions: string[]): void {
    const contextKeyService = this._accessor.get(IContextKeyService);

    // Set a context key for each permission category
    const categories = ['scheduling', 'demographics', 'chart', 'rx',
        'orders', 'documents', 'messaging', 'billing', 'reports', 'admin'];

    for (const cat of categories) {
        const hasCategory = permissions.some(p => p.startsWith(`${cat}.`));
        contextKeyService.createKey(`ciyex.perm.${cat}`, hasCategory);
    }
}
```

Then use these context keys in menu/view registration:

```typescript
// Calendar view only visible if user has scheduling permission
viewsRegistry.registerViews([{
    id: 'ciyex.calendar',
    name: 'Calendar',
    when: ContextKeyExpr.has('ciyex.perm.scheduling'),
    // ...
}], CALENDAR_CONTAINER);

// Settings menu only for admins
MenuRegistry.appendMenuItem(MenubarSettingsMenu, {
    command: { id: 'ciyex.openUserManagement', title: 'User Management' },
    when: ContextKeyExpr.has('ciyex.perm.admin'),
});
```

---

## 4. Screen Migration Strategy

### Approach A: WebviewPanel (Fastest, reuse React code)

Embed existing EHR React components inside VS Code WebviewPanels:

```typescript
class PatientChartEditor extends EditorPane {
    protected createEditor(parent: HTMLElement): void {
        const webview = this.webviewService.createWebviewOverlay({
            contentOptions: { allowScripts: true },
        });
        // Point to the built EHR UI bundle
        webview.setHtml(`
            <iframe src="https://app-dev.ciyex.org/patients/${patientId}"
                    style="width:100%;height:100%;border:none;" />
        `);
    }
}
```

**Pros:** Fastest migration, reuse existing React code
**Cons:** Not truly native, limited VS Code integration

### Approach B: Native TreeView + EditorPanes (Best UX)

Rewrite each EHR screen as a native VS Code component:

| EHR Screen | VS Code Component Type |
|---|---|
| Patient List | TreeView with search |
| Patient Chart | Custom EditorPane with tabs |
| Calendar | Custom EditorPane (FullCalendar in webview) |
| Encounter Form | Custom EditorPane with form widgets |
| Lab Orders | TreeView + detail panel |
| Settings | VS Code Settings UI pattern |
| Messaging | Panel view (like Terminal) |

### Approach C: Hybrid (Recommended)

1. **TreeViews** for navigation lists (patients, appointments, labs)
2. **WebviewPanels** for complex forms (encounter editor, patient chart)
3. **Native VS Code** for settings, search, and simple CRUD
4. **Status Bar** for practice info, user info, notifications count

---

## 5. Status Bar Migration

Replace the EHR header's user/notification section with Status Bar items:

```typescript
// Register status bar items
class CiyexStatusBarContribution implements IWorkbenchContribution {
    constructor(
        @IStatusbarService statusbarService: IStatusbarService,
    ) {
        // User info (right side)
        statusbarService.addEntry({
            id: 'ciyex.user',
            name: 'Ciyex User',
            text: '$(account) Michael Chen',
            tooltip: 'Signed in as michael.chen@example.com',
            command: 'ciyex.showUserMenu',
            showInAllWindows: true,
        }, 'ciyex.user', StatusbarAlignment.RIGHT, 100);

        // Practice/tenant (right side)
        statusbarService.addEntry({
            id: 'ciyex.practice',
            name: 'Practice',
            text: '$(organization) Demo Clinic',
            command: 'ciyex.switchPractice',
        }, 'ciyex.practice', StatusbarAlignment.RIGHT, 99);

        // Notifications count (right side)
        statusbarService.addEntry({
            id: 'ciyex.notifications',
            name: 'Notifications',
            text: '$(bell) 3',
            command: 'ciyex.showNotifications',
        }, 'ciyex.notifications', StatusbarAlignment.RIGHT, 98);
    }
}
```

---

## 6. Removing Unwanted Default VS Code Features

### Features to Remove for EHR Mode

| Feature | How to Remove |
|---|---|
| **Extensions Marketplace** | Set `extensionsGallery: {}` in product.json |
| **Source Control (Git)** | Disable via `when` clause: `ciyex.showDevMenus` |
| **Debug/Run** | Remove Debug viewlet registration or hide with context key |
| **Terminal** | Hide with context key, keep accessible via command |
| **Copilot/Chat** | Already removed from product.json defaultChatAgent |
| **Search** | Keep but rebrand as "Patient Search" |
| **Remote connections** | Remove from product.json |
| **Accounts** | Replace with Ciyex auth |

### product.json Adjustments

```json
{
    "extensionsGallery": {},
    "enableTelemetry": false,
    "welcomePage": "ciyex.welcome",
    "configurationDefaults": {
        "workbench.activityBar.visible": true,
        "workbench.sideBar.location": "left",
        "editor.minimap.enabled": false,
        "terminal.integrated.defaultProfile": null,
        "workbench.startupEditor": "ciyex.dashboard"
    }
}
```

### Hide Default Activity Bar Items

```typescript
// In ciyexEhr.contribution.ts, hide default containers when in EHR mode
const viewContainerRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);

// Move defaults to auxiliary bar or hide them
viewContainerRegistry.moveViewContainerTo(
    'workbench.view.debug',
    ViewContainerLocation.AuxiliaryBar
);
```

---

## 7. Migration Phases

### Phase 1: Authentication & Shell (DONE)
- [x] Two-step login gate
- [x] Session management & lock screen
- [x] Server settings popup
- [x] Ciyex branding (logo, icons, colors)

### Phase 2: Navigation Framework
- [ ] Register EHR ViewContainers in Activity Bar
- [ ] Create permission-based ContextKeys
- [ ] Add Clinical, Scheduling, Billing menus to menu bar
- [ ] Remove/hide unwanted VS Code menus (Terminal, Debug, Run)
- [ ] Add Status Bar items (user, practice, notifications)

### Phase 3: Core Screens (WebviewPanel)
- [ ] Patient List (TreeView + search)
- [ ] Calendar (WebviewPanel with FullCalendar)
- [ ] Patient Chart (WebviewPanel with tabs)
- [ ] Encounter Editor (WebviewPanel)
- [ ] Appointments (TreeView)

### Phase 4: Clinical Features
- [ ] Labs (TreeView + detail panel)
- [ ] Prescriptions (TreeView + editor)
- [ ] Immunizations, Care Plans, Referrals
- [ ] Messaging (Panel view)
- [ ] Document Scanning

### Phase 5: Admin & Settings
- [ ] Settings (native VS Code settings pattern)
- [ ] User Management
- [ ] Role/Permission Management
- [ ] Menu Configuration

### Phase 6: Native Optimization
- [ ] Replace WebviewPanels with native editors where possible
- [ ] Keyboard shortcuts for common EHR actions
- [ ] Command Palette integration for all EHR commands
- [ ] Offline mode with local data sync

---

## 8. File Structure

```
src/vs/workbench/contrib/ciyexEhr/
├── browser/
│   ├── ciyexEhr.contribution.ts      # Main registration
│   ├── ciyexMenus.ts                 # Menu bar customization
│   ├── ciyexContextKeys.ts           # Permission context keys
│   ├── views/
│   │   ├── calendarViewContainer.ts
│   │   ├── patientsViewContainer.ts
│   │   ├── clinicalViewContainer.ts
│   │   ├── billingViewContainer.ts
│   │   └── settingsViewContainer.ts
│   ├── editors/
│   │   ├── patientChartEditor.ts
│   │   ├── encounterEditor.ts
│   │   ├── calendarEditor.ts
│   │   └── labOrderEditor.ts
│   ├── statusbar/
│   │   └── ciyexStatusBar.ts
│   └── webview/
│       ├── patientChart.html
│       ├── calendar.html
│       └── encounterForm.html
```

---

## 9. Key Differences: Web vs Desktop

| Aspect | EHR Web UI | Ciyex Workspace |
|---|---|---|
| Navigation | URL-based routing | ViewContainer switching |
| Multi-tab | Browser tabs | Editor tabs (split views) |
| Offline | No | Yes (with local storage) |
| File access | Upload only | Direct filesystem access |
| Notifications | Browser API | Native OS notifications |
| Keyboard | Limited shortcuts | Full keybinding system |
| Drag & Drop | Limited | Native file drag & drop |
| Performance | Browser overhead | Native Electron |
| Updates | Instant (web deploy) | Auto-update (Electron) |

---

## 10. API Integration

The desktop app calls the same Ciyex backend API (`api-dev.ciyex.org`). 

**Auth flow:**
1. Login via auth gate (already implemented)
2. Token stored in localStorage
3. All API calls include `Authorization: Bearer <token>` header
4. CORS handled by `webSecurity: false` in Electron

**Fetch wrapper for VS Code context:**
```typescript
// Create a service that wraps fetch with auth headers
class CiyexApiService {
    async fetch(path: string, options?: RequestInit): Promise<Response> {
        const token = localStorage.getItem('ciyex_token');
        const tenant = localStorage.getItem('ciyex_selected_tenant');
        return fetch(`${this.apiUrl}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'X-Tenant-Name': tenant || '',
                ...options?.headers,
            },
        });
    }
}
```
