# Settings Implementation Checklist

## Problems with Current Implementation
1. ~~Settings only accessible via Cmd+Shift+P (not in menus)~~ ✅ Fixed
2. ~~No CRUD operations (read-only views)~~ ✅ Fixed
3. ~~Not VS Code-native UX (copied web patterns)~~ ✅ Fixed
4. ~~No inline editing, no forms, no confirmations~~ ✅ Fixed

## VS Code-Native UX Approach
- **Simple values** → VS Code Settings Editor (Cmd+,) with `@ciyex` filter
- **CRUD lists** → WebviewPanel with table + drawer form (like User Management)
- **Config editors** → WebviewPanel with interactive controls + Save/Reset
- **All accessible from** → Ciyex menu + Settings gear menu + Cmd+Shift+P + Admin menu

## Checklist

### 1. Menu Access (HIGH PRIORITY)
- [x] Ciyex menu has leaf items (Calendar, Patients, etc.)
- [x] Clinical/Operations/System/Portal as top-level menus
- [x] Add "Settings" submenu to Ciyex menu with: Users, Roles, Layout, Encounter, Portal, Calendar Colors
- [x] Settings gear menu: Chart Layout, Encounter Form, Patient Portal
- [x] Admin menu bar: User Management, Roles, Menu Config, Chart Layout, Encounter, Calendar Colors, Portal, Practice, Providers

### 2. User Management - FULL CRUD
- [x] User table with search, filter by Staff/Patients tabs
- [x] Create User: form drawer with name, email, role, welcome email options
- [x] Edit User: form drawer with editable fields
- [x] Reset Password: confirmation dialog + show temp password
- [x] Send Password Reset Email: confirmation + toast
- [x] Link Practitioner: prompt for FHIR Practitioner ID
- [x] Deactivate User: confirmation dialog
- [x] Activate User: one-click with toast
- [x] Role badges, FHIR link status, active/disabled status
- [x] Initials avatar circles

### 3. Roles & Permissions - FULL CRUD
- [x] Role cards with expand/collapse
- [x] Create Role: form with name, label, description
- [x] FHIR SMART Scopes matrix (resource × read/write checkboxes)
- [x] Feature Permissions matrix (category × action checkboxes)
- [x] Quick-toggle individual scopes/permissions inline
- [x] Delete role (with system role protection)
- [x] Edit role (populate drawer from data)

### 4. Menu Configuration - FULL CRUD
- [x] Tree view of menu hierarchy with indentation
- [x] Add custom menu item (label, icon, route, FHIR resources, parent)
- [x] Edit menu item (label, icon, route)
- [x] Reorder items (up/down)
- [x] Hide/Show items (toggle visibility)
- [x] Delete custom items
- [x] Restore hidden items
- [x] Reset all customizations
- [x] JSON code view toggle

### 5. Chart Layout (Tab Manager) - FULL CRUD
- [x] Category list with tabs (from API)
- [x] Add tab to category (form drawer)
- [x] Edit tab (label, icon, key, FHIR resources)
- [x] Reorder tabs within category (functional)
- [x] Toggle tab visibility (functional)
- [x] Move tab between categories (via drawer)
- [x] Add/remove categories
- [x] Save Changes → PUT /api/tab-field-config/layout
- [x] Reset to Defaults → DELETE /api/tab-field-config/layout
- [x] Open field config for tab (⚙ button)

### 6. Field Configuration - FULL CRUD
- [x] Section list with fields (from API)
- [x] Tab selector (tabKey parameter)
- [x] Add section
- [x] Add field to section (with full field editor drawer)
- [x] Edit field: key, label, type (27 types), colSpan, required, placeholder
- [x] Edit FHIR mapping: resource, path, type
- [x] Edit options (for select/radio types)
- [x] Edit validation rules (min, max, pattern)
- [x] Reorder fields within section
- [x] Reorder sections
- [x] Remove field/section with confirmation
- [x] Save → PUT /api/tab-field-config/{tabKey}
- [x] Reset → DELETE /api/tab-field-config/{tabKey}
- [x] Preview mode (render form from config)

### 7. Encounter Settings - UPDATE
- [x] Section list with field counts (from API)
- [x] Toggle section visibility (inline switch)
- [x] Change columns (1-4 dropdown, inline)
- [x] Toggle collapsible (inline switch)
- [x] Reorder sections (up/down)
- [x] Search/filter sections
- [x] Save → PUT /api/tab-field-config/encounter-form
- [x] Reset → DELETE /api/tab-field-config/encounter-form

### 8. Calendar Colors - UPDATE
- [x] Color grid for visit types, providers, locations (tabbed)
- [x] Color picker per entity (native color input + hex text)
- [x] Auto-generate colors button
- [x] Contrast-aware text color preview
- [x] Save Colors → POST /api/ui-colors
- [x] Reset to Defaults → DELETE /api/ui-colors

### 9. Portal Settings - CRUD
- [x] General tab: branding form (name, URL, language, timezone)
- [x] Features tab: toggle switches for each feature
- [x] Forms tab: create/edit/delete portal forms with field builder (inline field editor)
- [x] Navigation tab: reorder/toggle portal menu items
- [x] Save per tab → PATCH /api/portal/config/{section}

### 10. Generic Settings (FHIR Resources) - FULL CRUD
- [x] Practice info CRUD (form with full fields, save to API)
- [x] Providers list + create/edit/delete (table + drawer)
- [ ] Facilities list + create/edit/delete (future)
- [ ] Insurance payers list + create/edit/delete (future)
- [ ] Referral providers/practices (future)

### 11. Webview-Host API Bridge
- [x] Message passing: webview → host → API → host → webview
- [x] Auth token forwarding (via ICiyexApiService)
- [x] Error handling with VS Code native notifications
- [x] Confirmation dialogs using VS Code IDialogService
- [x] Loading states (spinner overlay)
- [x] Shared CSS design system (ciyexWebviewBridge.ts)
- [x] Shared JS utilities (callApi, hostConfirm, hostNotify, showToast)
- [x] SVG icon system (edit, trash, add, chevrons, eye, settings, json, list, close)

### 12. VS Code Integration
- [x] All settings commands in Command Palette (f1: true)
- [x] Settings items in Ciyex menu (Settings submenu — all 9 settings)
- [x] Settings items in gear menu (GlobalActivity — all 9 settings)
- [x] Admin menu bar items (MenubarAdminMenu — 9 items)
- [x] Confirmation dialogs using VS Code native IDialogService
- [x] Toast notifications using VS Code INotificationService

### 13. JSON Editor View
- [x] Visual/JSON toggle button in toolbar (all config editors)
- [x] JSON editor textarea with monospace font, syntax-aware
- [x] JSON validation with error display
- [x] Format JSON button
- [x] Copy to clipboard button
- [x] Apply JSON to visual editor (bidirectional sync)
- [x] Available in: Chart Layout, Field Config, Encounter Form, Menu Config
