# EHR Settings -> VS Code Native Settings Migration Guide

## Design Principle: Smooth Navigation, Fewer Clicks

The EHR web UI settings use a sidebar + tabs + sub-pages pattern requiring multiple clicks to reach a setting. The VS Code native settings pattern puts everything in a searchable, single-page tree with categories. This migration prioritizes:

- **Search-first**: Cmd+, opens settings, type to find any setting instantly
- **Flat hierarchy**: No nested pages, all settings visible in one scrollable tree
- **Grouped by domain**: EHR categories (Users, Roles, Layout, Encounter, Calendar, Portal) as top-level groups
- **Zero navigation clicks**: Every setting reachable by typing its name

---

## Architecture Mapping

| EHR UI Pattern | VS Code Pattern |
|---|---|
| Settings hub page with sidebar tabs | Single Settings Editor (Cmd+,) with TOC tree |
| `/settings/user-management` page | "Ciyex: User Management" settings group |
| `/settings/roles-permissions` page | "Ciyex: Roles & Permissions" settings group |
| `/settings/menu-configuration` page | "Ciyex: Menu Configuration" settings group |
| `/settings/layout-settings` page | "Ciyex: Chart Layout" settings group |
| `/settings/encounter-settings` page | "Ciyex: Encounter Form" settings group |
| `/settings/calendar-colors` page | "Ciyex: Calendar" settings group |
| `/settings/portal-settings` page | "Ciyex: Patient Portal" settings group |
| `/settings/ai-usage` page | "Ciyex: AI Features" settings group |
| Display settings (font size) | "Ciyex: Display" settings group |
| Plugin settings | "Ciyex: Extensions > {Plugin}" settings group |
| Generic FHIR settings pages | "Ciyex: Practice > {Resource}" settings group |

---

## Settings Registration Pattern

All EHR settings are registered via `IConfigurationRegistry` so they appear in the native VS Code Settings Editor (Cmd+,).

```typescript
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationRegistry, Extensions as ConfigExtensions } from '../../../../platform/configuration/common/configurationRegistry.js';

const configRegistry = Registry.as<IConfigurationRegistry>(ConfigExtensions.Configuration);

configRegistry.registerConfiguration({
    id: 'ciyex',
    title: 'Ciyex Workspace',
    order: 1,
    properties: {
        'ciyex.server.apiUrl': {
            type: 'string',
            default: 'https://api-dev.ciyex.org',
            description: 'Ciyex API server URL',
            order: 1,
        },
        'ciyex.server.keycloakUrl': {
            type: 'string',
            default: 'https://dev.aran.me',
            description: 'Keycloak authentication server URL',
            order: 2,
        },
        // ... more settings
    }
});
```

---

## Detailed Settings Groups

### 1. Ciyex: Server Connection

| Setting Key | Type | Default | EHR Equivalent |
|---|---|---|---|
| `ciyex.server.apiUrl` | string | `https://api-dev.ciyex.org` | Server Settings popup |
| `ciyex.server.keycloakUrl` | string | `https://dev.aran.me` | Server Settings popup |
| `ciyex.server.keycloakRealm` | string | `ciyex` | Server Settings popup |
| `ciyex.server.keycloakClientId` | string | `ciyex-app` | Server Settings popup |
| `ciyex.server.environment` | enum | `dev` | Environment indicator |

### 2. Ciyex: Display

| Setting Key | Type | Default | EHR Equivalent |
|---|---|---|---|
| `ciyex.display.fontSize` | enum: small/default/large/x-large | `default` | DisplaySettings component |
| `ciyex.display.compactMode` | boolean | `false` | Dense row spacing |
| `ciyex.display.showAvatars` | boolean | `true` | Avatar circles in lists |

### 3. Ciyex: Calendar

| Setting Key | Type | Default | EHR Equivalent |
|---|---|---|---|
| `ciyex.calendar.defaultView` | enum: day/week/month | `week` | Calendar view preference |
| `ciyex.calendar.startHour` | number | `8` | Day start time |
| `ciyex.calendar.endHour` | number | `18` | Day end time |
| `ciyex.calendar.slotDuration` | number | `15` | Slot duration in minutes |
| `ciyex.calendar.colorBy` | enum: visit-type/provider/location | `visit-type` | Color coding source |

### 4. Ciyex: Session

| Setting Key | Type | Default | EHR Equivalent |
|---|---|---|---|
| `ciyex.session.idleTimeoutMinutes` | number | `30` | Idle timeout |
| `ciyex.session.showWarningMinutes` | number | `2` | Warning before timeout |
| `ciyex.session.autoRefreshToken` | boolean | `true` | JWT auto-refresh |

---

## Complex Settings (Custom Editor Pages)

Settings that require custom UI (not just simple key-value) are implemented as **WebviewPanel commands** accessible from the Command Palette and Settings Editor "Edit in..." links.

### 5. Ciyex: User Management (Custom Editor)

**Command:** `ciyex.openUserManagement` (Cmd+Shift+P -> "Manage Users")

Opens a WebviewPanel with:
- User list table (name, email, role, status)
- Create user dialog
- Edit user inline
- Reset password action
- Link practitioner action
- Deactivate user action

**API:** `/api/admin/users`, `/api/admin/roles`

### 6. Ciyex: Roles & Permissions (Custom Editor)

**Command:** `ciyex.openRolesPermissions` (Cmd+Shift+P -> "Manage Roles")

Opens a WebviewPanel with:
- Role cards with expandable sections
- FHIR SMART scopes matrix (resource x read/write)
- Feature permissions matrix (category x action)
- Create/Edit/Delete role actions

**API:** `/api/admin/roles`

### 7. Ciyex: Menu Configuration (Custom Editor)

**Command:** `ciyex.openMenuConfiguration` (Cmd+Shift+P -> "Configure Menu")

Opens a WebviewPanel with:
- Menu tree with drag-drop reorder
- Show/hide toggle per item
- Edit label, icon, route
- Add custom items
- Reset to defaults
- JSON code viewer

**API:** `/api/menus/ehr-sidebar/*`

### 8. Ciyex: Chart Layout (Custom Editor)

**Command:** `ciyex.openChartLayout` (Cmd+Shift+P -> "Configure Chart Layout")

Opens a WebviewPanel with:
- Tab Manager: reorder, show/hide, edit labels
- Field Configuration: add/edit fields per tab
- Field type selector, validation rules, FHIR mappings
- JSON code viewer
- Reset to defaults

**API:** `/api/tab-field-config/layout`, `/api/tab-field-config/{tabKey}`

### 9. Ciyex: Encounter Form (Custom Editor)

**Command:** `ciyex.openEncounterSettings` (Cmd+Shift+P -> "Configure Encounter Form")

Opens a WebviewPanel with:
- Section list with enable/disable toggles
- Reorder sections (up/down)
- Column count selector (1-4)
- Collapsible toggle
- Default collapsed state
- Reset to defaults

**API:** `/api/tab-field-config/encounter-form`

### 10. Ciyex: Patient Portal (Custom Editor)

**Command:** `ciyex.openPortalSettings` (Cmd+Shift+P -> "Configure Patient Portal")

Opens a WebviewPanel with:
- General tab: branding, language, timezone
- Features tab: toggle portal features
- Forms tab: form builder with fields
- Navigation tab: portal menu items

**API:** `/api/portal/config`, `/api/portal/config/forms`

### 11. Ciyex: Calendar Colors (Custom Editor)

**Command:** `ciyex.openCalendarColors` (Cmd+Shift+P -> "Configure Calendar Colors")

Opens a WebviewPanel with:
- Tabs: Visit Types, Providers, Locations
- Color picker for background, border, text
- Auto-generate colors option
- Preview with contrast check

**API:** `/api/calendar-colors/{category}`

---

## Navigation Flow (Zero-Click Design)

```
User wants to change a setting
    |
    v
Cmd+, (opens Settings Editor)
    |
    v
Type setting name (e.g., "idle timeout")
    |
    v
Setting appears instantly: "Ciyex > Session > Idle Timeout Minutes: [30]"
    |
    v
Change value inline. Done.

--- OR for complex settings ---

Cmd+Shift+P -> "Configure Chart Layout"
    |
    v
WebviewPanel opens with the full editor. Done.
```

**No navigation menus, no sidebar tabs, no sub-pages.** Everything is either:
1. A searchable setting in Cmd+, (simple values)
2. A command in Cmd+Shift+P (complex editors)

---

## Plugin Settings Pattern

Each installed plugin's settings appear under "Ciyex: Extensions > {Plugin Name}":

```typescript
// Plugin contributes settings via app-installations config schema
configRegistry.registerConfiguration({
    id: `ciyex.extensions.${pluginSlug}`,
    title: `Ciyex: ${pluginName}`,
    properties: {
        [`ciyex.extensions.${pluginSlug}.enabled`]: {
            type: 'boolean',
            default: true,
            description: `Enable ${pluginName}`,
        },
        // Dynamic properties from plugin's configSchema
    }
});
```

Plugin config values are synced between VS Code settings and `/api/app-installations/{slug}/config`.

---

## Practice/Org Settings (FHIR Resources)

Generic FHIR resource settings (Practice, Providers, Facilities, Insurance) are accessed via commands:

| Command | Description |
|---|---|
| `ciyex.managePractice` | Practice info, address, contact |
| `ciyex.manageProviders` | Provider list, NPI, specialties |
| `ciyex.manageFacilities` | Facility locations |
| `ciyex.manageInsurance` | Insurance payers |
| `ciyex.manageReferralProviders` | Referral provider directory |

Each opens a WebviewPanel with list/create/edit/view modes rendered from the tab-field-config metadata.

---

## Implementation Checklist

### Phase 1: Settings Registration (Simple Key-Value) - DONE
- [x] Create `ciyexSettings.ts` - register all simple settings via IConfigurationRegistry
- [x] Server connection settings (apiUrl, keycloakUrl, realm, clientId, environment)
- [x] Display settings (fontSize, compactMode, showAvatars)
- [x] Calendar settings (defaultView, startHour, endHour, slotDuration, colorBy)
- [x] Session settings (idleTimeoutMinutes, warningMinutes, autoRefreshToken, loginRequired)
- [x] Features settings (showDevMenus, cdsHooksEnabled, smartLaunchEnabled)
- [ ] Migrate CiyexAuthService to read from IConfigurationService instead of localStorage
- [ ] Migrate CiyexPermissionService to read session settings from config

### Phase 2: User & Role Management Commands - DONE
- [x] `ciyex.openUserManagement` - WebviewPanel with user table from /api/admin/users
- [x] `ciyex.openRolesPermissions` - WebviewPanel with role cards + permissions/scopes
- [x] Admin menu bar with all settings commands (admin-only)
- [ ] User create/edit/delete actions (interactive webview forms)
- [ ] Reset password action in user management

### Phase 3: Layout & Form Configuration Commands - DONE
- [x] `ciyex.openChartLayout` - Tab visibility from /api/tab-field-config/layout
- [x] `ciyex.openEncounterSettings` - Section list from /api/tab-field-config/encounter-form
- [x] `ciyex.openMenuConfiguration` - Menu tree from /api/menus/ehr-sidebar
- [ ] Interactive editing (toggle visibility, reorder)
- [ ] JSON code viewer for raw config inspection

### Phase 4: Portal & Calendar Settings Commands - DONE
- [x] `ciyex.openPortalSettings` - Placeholder (4-tab portal config)
- [x] `ciyex.openCalendarColors` - Placeholder (color picker)
- [x] `ciyex.managePractice` - Placeholder (practice info)
- [x] `ciyex.manageProviders` - Provider list from /api/providers
- [ ] Full portal form builder
- [ ] Color picker with auto-generate

### Phase 5: Plugin Settings Sync
- [ ] Load installed plugin configs from /api/app-installations
- [ ] Register each plugin's configSchema as VS Code settings
- [ ] Two-way sync: VS Code settings <-> API config
- [ ] Plugin enable/disable toggle

### Phase 6: Practice Resource Management
- [ ] `ciyex.managePractice` - Practice info editor
- [ ] `ciyex.manageProviders` - Provider list/CRUD
- [ ] `ciyex.manageFacilities` - Facility list/CRUD
- [ ] `ciyex.manageInsurance` - Insurance payer list/CRUD
- [ ] `ciyex.manageReferralProviders` - Referral directory
- [ ] Dynamic form rendering from tab-field-config metadata

### Phase 7: Settings Sync & Persistence
- [ ] Settings stored in VS Code user settings (settings.json)
- [ ] Server-side settings synced on login
- [ ] Conflict resolution (server wins for org-level, local wins for user-level)
- [ ] Settings export/import

---

## File Structure

```
src/vs/workbench/contrib/ciyexEhr/browser/
├── settings/
│   ├── ciyexSettings.ts              # IConfigurationRegistry registrations
│   ├── ciyexSettingsSync.ts          # Sync VS Code settings <-> API
│   ├── userManagementEditor.ts       # User CRUD webview
│   ├── rolesPermissionsEditor.ts     # Roles + scopes webview
│   ├── menuConfigEditor.ts           # Menu tree editor webview
│   ├── chartLayoutEditor.ts          # Tab/field config webview
│   ├── encounterSettingsEditor.ts    # Encounter form config webview
│   ├── portalSettingsEditor.ts       # Portal config webview
│   ├── calendarColorsEditor.ts       # Color picker webview
│   └── practiceResourceEditor.ts     # Generic FHIR resource CRUD webview
```

---

## Settings Categories in VS Code Settings Editor (Cmd+,)

```
Ciyex Workspace
├── Server
│   ├── API URL
│   ├── Keycloak URL
│   ├── Keycloak Realm
│   └── Keycloak Client ID
├── Display
│   ├── Font Size
│   ├── Compact Mode
│   └── Show Avatars
├── Calendar
│   ├── Default View
│   ├── Start Hour
│   ├── End Hour
│   ├── Slot Duration
│   └── Color By
├── Session
│   ├── Idle Timeout Minutes
│   ├── Warning Minutes
│   └── Auto Refresh Token
└── Extensions
    ├── ciyex-rcm
    ├── ciyex-lab
    ├── ciyex-telehealth
    └── ...

--- Complex settings (via Command Palette) ---
> Manage Users
> Manage Roles & Permissions
> Configure Menu
> Configure Chart Layout
> Configure Encounter Form
> Configure Patient Portal
> Configure Calendar Colors
> Manage Practice Info
> Manage Providers
> Manage Facilities
> Manage Insurance Payers
```
