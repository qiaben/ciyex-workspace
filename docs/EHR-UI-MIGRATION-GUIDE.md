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

---

## 11. Dynamic Layout & Configurability System

The EHR UI uses a **3-layer configurability architecture** where menus, screens, forms, and charts are fully configurable per organization. This must be preserved in the VS Code migration.

### Configurability Layers

```
Layer 1: UNIVERSAL_DEFAULT     (shipped with app, fallback)
Layer 2: PRACTICE_TYPE_DEFAULT (per practice type: primary care, dental, etc.)
Layer 3: ORG_CUSTOM            (per-org overrides set by admin)
```

### 11.1 API-Driven Menu Configuration

Menus are NOT hardcoded - they're fetched from the backend and customizable per org.

**API Endpoints:**
```
GET    /api/menus/ehr-sidebar              - Resolved menu tree (after RBAC filtering)
GET    /api/menus/ehr-sidebar/overrides    - Org-level customizations
GET    /api/menus/ehr-sidebar/has-custom   - Check if org has custom menu
POST   /api/menus/ehr-sidebar/items/{id}/hide    - Hide an item
DELETE /api/menus/ehr-sidebar/items/{id}/hide    - Restore an item
PUT    /api/menus/ehr-sidebar/items/{id}/modify  - Edit label/icon/route
POST   /api/menus/ehr-sidebar/custom-items       - Add custom item
PUT    /api/menus/ehr-sidebar/reorder            - Reorder items
POST   /api/menus/ehr-sidebar/reset              - Reset to defaults
```

**VS Code Implementation:**
```typescript
// CiyexMenuService - fetches menu tree from API and registers VS Code menus dynamically
class CiyexMenuService {
    async loadMenus(): Promise<void> {
        const menuTree = await this.api.fetch('/api/menus/ehr-sidebar');
        
        // Clear existing dynamic registrations
        this._disposables.forEach(d => d.dispose());
        
        // Register each menu item as VS Code ViewContainer or MenuRegistry entry
        for (const item of menuTree) {
            if (item.children?.length) {
                // Parent with children -> ViewContainer in activity bar
                this._registerViewContainer(item);
            } else {
                // Leaf item -> command + menu entry
                this._registerMenuCommand(item);
            }
        }
    }
    
    private _registerViewContainer(item: MenuItem): void {
        // Dynamic ViewContainer registration based on API menu data
        const container = viewContainerRegistry.registerViewContainer({
            id: `ciyex.menu.${item.itemKey}`,
            title: { value: item.label, original: item.label },
            icon: this._resolveIcon(item.icon),
            order: item.position,
        }, ViewContainerLocation.Sidebar);
        
        // Apply RBAC visibility via when clause
        if (item.requiredPermission) {
            // Container visible only when user has the permission
            container.when = ContextKeyExpr.has(`ciyex.perm.${item.requiredPermission}`);
        }
    }
}
```

### 11.2 Dynamic Form/Screen Rendering (Tab-Field Config)

Screens are defined by metadata, not code. Each screen has a **FieldConfig** that defines sections, fields, types, and FHIR mappings.

**API Endpoints:**
```
GET    /api/tab-field-config/layout          - Global layout (tabs)
GET    /api/tab-field-config/{pageKey}        - Page-specific config
GET    /api/tab-field-config/all              - All configurations
GET    /api/tab-field-config/tabs             - Available tabs
PUT    /api/tab-field-config/{pageKey}        - Save page config
DELETE /api/tab-field-config/{pageKey}        - Reset page config
GET    /api/tab-field-config/encounter-form   - Encounter form config
```

**FieldConfig Structure:**
```typescript
interface FieldConfig {
    sections: SectionDef[];
    features?: { fileUpload?: boolean };
}

interface SectionDef {
    key: string;
    title: string;
    columns: number;           // 1, 2, 3, or 4 column layout
    collapsible: boolean;
    collapsed: boolean;        // default collapsed state
    visible: boolean;
    fields: FieldDef[];
    showWhen?: { field: string; value: any }; // conditional visibility
}

interface FieldDef {
    key: string;
    label: string;
    type: 'text' | 'select' | 'multiselect' | 'date' | 'checkbox' |
          'radio' | 'textarea' | 'number' | 'file' | 'lookup' |
          'coded' | 'ros-grid' | 'exam-grid' | 'diagnosis-list' |
          'computed' | 'group' | 'family-history-list';
    required: boolean;
    colSpan: number;
    placeholder?: string;
    helpText?: string;
    options?: Array<{ label: string; value: string }>;
    fhirMapping?: {
        resource: string;      // e.g., "Patient", "Observation"
        path: string;          // e.g., "name[0].given[0]"
        type: string;          // e.g., "string", "CodeableConcept"
        loincCode?: string;
        unit?: string;
    };
    validation?: {
        min?: number; max?: number;
        minLength?: number; maxLength?: number;
        pattern?: string;
    };
    showWhenCondition?: { field: string; operator: string; value: any };
}
```

**VS Code Implementation - Dynamic Form Renderer:**
```typescript
// Each dynamic screen is a WebviewPanel that loads its config from the API
class DynamicScreenEditor extends EditorPane {
    async setInput(input: DynamicScreenInput): Promise<void> {
        // Fetch the field config for this screen
        const config = await this.api.fetch(`/api/tab-field-config/${input.pageKey}`);
        
        // Render the form in a webview using the config
        this.webview.postMessage({
            type: 'loadConfig',
            config: config,
            data: await this.loadResourceData(input),
        });
    }
}
```

### 11.3 Plugin Slot Architecture

The EHR uses a **named slot system** for extensibility. Plugins contribute components to named slots.

**Key Slots:**
```
patient-chart:tab           - Custom tabs in patient chart
patient-chart:action        - Action buttons on patient chart
encounter:section           - Custom sections in encounter form
settings:nav-item           - Custom settings pages
global:nav-item             - Custom sidebar items
global:header-action        - Custom header buttons
dashboard:widget            - Dashboard widgets/charts
```

**VS Code Mapping:**
```typescript
// Plugin slots map to VS Code extension contribution points:
// patient-chart:tab     -> Custom EditorTab in patient chart editor
// encounter:section     -> Custom ViewPane in encounter container
// settings:nav-item     -> Custom settings section
// global:nav-item       -> Custom ViewContainer in activity bar
// dashboard:widget      -> Custom webview widget
```

### 11.4 Settings Editors (Admin)

These admin pages allow non-developer customization:

| Settings Page | What It Configures | VS Code Equivalent |
|---|---|---|
| `/settings/layout-settings` | Patient chart tabs, field order, visibility | Custom EditorPane with drag-drop |
| `/settings/layout-settings/config/[pageKey]` | Per-page field config | Custom EditorPane |
| `/settings/menu-configuration` | Sidebar menu items, order, visibility | Custom TreeView with drag-drop |
| `/settings/encounter-settings` | Encounter form sections, fields | Custom EditorPane |
| `/settings/user-management` | Users, roles, passwords | Custom TreeView + detail panel |
| `/settings/roles-permissions` | RBAC permissions | Custom EditorPane |
| `/settings/calendar-colors` | Appointment type colors | Native VS Code color picker |
| `/settings/portal-settings` | Patient portal config | Custom EditorPane |

---

## 12. Role-Based Access Control (RBAC) & FHIR Scopes

### 12.1 Permission Architecture

The EHR uses a **category-based permission system** that maps to FHIR resource scopes.

**Permission Format:** `{category}.{action}`
```
scheduling.read         - View calendar/appointments
scheduling.write        - Create/edit appointments
demographics.read       - View patient data
demographics.write      - Create/edit patients
chart.read              - View encounters, care plans
chart.write             - Create/edit encounters
rx.read                 - View prescriptions
rx.write                - Create prescriptions
orders.read             - View lab orders/results
orders.write            - Create lab orders
documents.read          - View documents
documents.write         - Upload documents
messaging.read          - View messages
messaging.write         - Send messages
billing.read            - View payments/claims
billing.write           - Create payments/claims
reports.read            - View reports
admin.read              - View settings
admin.write             - Modify settings
```

**FHIR Resource Scopes (from Keycloak token):**
```
patient/Patient.read     -> demographics.read
patient/Patient.write    -> demographics.write
patient/Appointment.read -> scheduling.read
patient/Encounter.read   -> chart.read
patient/Observation.read -> chart.read
patient/MedicationRequest.write -> rx.write
// etc.
```

### 12.2 VS Code Implementation

```typescript
// CiyexPermissionService - loaded after login, sets ContextKeys
class CiyexPermissionService {
    private _contextKeys = new Map<string, IContextKey<boolean>>();
    
    async loadPermissions(): Promise<void> {
        // Fetch from API
        const response = await this.api.fetch('/api/user/permissions');
        const { permissions, writableResources, readableResources, role } = response;
        
        // Set permission category context keys
        const categories = [
            'scheduling', 'demographics', 'chart', 'rx', 'orders',
            'documents', 'messaging', 'billing', 'reports', 'admin'
        ];
        
        for (const cat of categories) {
            const hasRead = permissions.some(p => p.startsWith(`${cat}.`));
            const hasWrite = permissions.some(p => p === `${cat}.write`);
            this._setKey(`ciyex.perm.${cat}`, hasRead);
            this._setKey(`ciyex.perm.${cat}.write`, hasWrite);
        }
        
        // Set FHIR resource scope context keys
        for (const resource of readableResources) {
            this._setKey(`ciyex.fhir.read.${resource}`, true);
        }
        for (const resource of writableResources) {
            this._setKey(`ciyex.fhir.write.${resource}`, true);
        }
        
        // Set role context keys
        this._setKey(`ciyex.role.admin`, role === 'ADMIN' || role === 'SUPER_ADMIN');
        this._setKey(`ciyex.role.provider`, role === 'PROVIDER');
        this._setKey(`ciyex.role.nurse`, role === 'NURSE');
        this._setKey(`ciyex.role.billing`, role === 'BILLING');
        this._setKey(`ciyex.role.frontDesk`, role === 'FRONT_DESK');
    }
    
    private _setKey(key: string, value: boolean): void {
        let ctxKey = this._contextKeys.get(key);
        if (!ctxKey) {
            ctxKey = this.contextKeyService.createKey(key, false);
            this._contextKeys.set(key, ctxKey);
        }
        ctxKey.set(value);
    }
}
```

### 12.3 Using Permissions in Menus & Views

```typescript
// Activity bar item only visible if user has scheduling permission
viewContainerRegistry.registerViewContainer({
    id: 'ciyex.calendar',
    title: 'Calendar',
    icon: Codicon.calendar,
    when: ContextKeyExpr.has('ciyex.perm.scheduling'),  // RBAC gate
}, ViewContainerLocation.Sidebar);

// "New Patient" button only if user can write Patient resources
MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
    command: { id: 'ciyex.newPatient', title: 'New Patient' },
    when: ContextKeyExpr.has('ciyex.fhir.write.Patient'),  // FHIR scope gate
    group: 'ciyex_create',
    order: 1,
});

// Admin settings only for admin role
MenuRegistry.appendMenuItem(MenuId.MenubarMainMenu, {
    submenu: MenubarAdminMenu,
    title: 'Admin',
    when: ContextKeyExpr.has('ciyex.role.admin'),  // Role gate
    order: 8,
});

// Prescriptions view only if rx permission AND MedicationRequest scope
viewsRegistry.registerViews([{
    id: 'ciyex.prescriptions',
    name: 'Prescriptions',
    when: ContextKeyExpr.and(
        ContextKeyExpr.has('ciyex.perm.rx'),
        ContextKeyExpr.has('ciyex.fhir.read.MedicationRequest'),
    ),
}], CLINICAL_CONTAINER);
```

### 12.4 Dynamic Menu Filtering Flow

```
User logs in
    |
    v
POST /api/auth/login -> JWT token (contains groups, org, FHIR scopes)
    |
    v
GET /api/user/permissions -> { permissions[], writableResources[], readableResources[], role }
    |
    v
CiyexPermissionService.loadPermissions()
    -> Sets 40+ ContextKeys (ciyex.perm.*, ciyex.fhir.*, ciyex.role.*)
    |
    v
GET /api/menus/ehr-sidebar -> Menu tree (already server-filtered by role)
    |
    v
CiyexMenuService.loadMenus()
    -> Registers ViewContainers with 'when' clauses from menu.requiredPermission
    -> Each menu item's when = ContextKeyExpr.has('ciyex.perm.' + requiredPermission)
    |
    v
VS Code evaluates ContextKeys -> shows/hides menus, views, commands automatically
```

### 12.5 Role-to-Menu Visibility Matrix

| Menu Item | ADMIN | PROVIDER | NURSE | FRONT_DESK | BILLING |
|---|---|---|---|---|---|
| Calendar | Yes | Yes | Yes | Yes | No |
| Patients | Yes | Yes | Yes | Yes | No |
| Encounters | Yes | Yes | Yes | No | No |
| Prescriptions | Yes | Yes | No | No | No |
| Labs | Yes | Yes | Yes | No | No |
| Payments | Yes | No | No | No | Yes |
| Claims | Yes | No | No | No | Yes |
| Reports | Yes | Yes | No | No | Yes |
| Settings | Yes | No | No | No | No |
| User Mgmt | Yes | No | No | No | No |
```
