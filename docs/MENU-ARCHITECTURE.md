# Menu Architecture: Default VS Code Menus vs Dynamic EHR Menus

## Overview

Ciyex Workspace uses a hybrid menu approach:
- **Default VS Code menus** (File, Edit, View, Go, Help) are kept as-is
- **Hidden VS Code menus** (Selection, Terminal, Run) are removed for EHR users
- **Dynamic EHR menus** are loaded from `/api/menus/ehr-sidebar` after login
- **Admin menu** is statically registered (admin-only, contains settings commands)

## Default VS Code Menus (KEEP)

These menus are part of the standard VS Code shell and should be kept:

| Menu | Source | Why Keep |
|------|--------|----------|
| **File** | `menubarControl.ts` (static) | Open folder, preferences, recent files |
| **Edit** | `menubarControl.ts` (static) | Undo/redo, find/replace, clipboard |
| **View** | `menubarControl.ts` (static) | Sidebar toggles, zoom, appearance |
| **Go** | `menubarControl.ts` (static) | Go to file, line, symbol |
| **Help** | `menubarControl.ts` (static) | About, documentation, updates |
| **Window** | macOS native (static) | Minimize, zoom, bring to front |

## Hidden VS Code Menus (REMOVED)

These menus are hidden via `when: ContextKeyExpr.has('ciyex.showDevMenus')`:

| Menu | Why Hidden | How to Re-enable |
|------|-----------|------------------|
| **Selection** | Code-editing focused, not relevant for EHR | Set `ciyex.features.showDevMenus: true` in Settings |
| **Terminal** | Developer tool, not for clinical users | Same |
| **Run/Debug** | Developer tool | Same |

## Dynamic EHR Menus (FROM API)

These menus are loaded from `/api/menus/ehr-sidebar` after the user logs in.
Each top-level menu item with children becomes a **menu bar submenu**.

### API Response Format

```
GET /api/menus/ehr-sidebar
Authorization: Bearer {token}

Response: {
  "items": [
    {
      "item": {
        "id": "...",
        "itemKey": "clinical",
        "label": "Clinical",
        "icon": "Stethoscope",
        "screenSlug": null,          // null = parent menu (has children)
        "position": 8,
        "requiredPermission": null,
        "roles": null
      },
      "children": [
        {
          "item": {
            "itemKey": "prescriptions",
            "label": "Prescriptions",
            "screenSlug": "/prescriptions",
            ...
          },
          "children": []
        },
        ...
      ]
    },
    ...
  ]
}
```

### Current API Menu Items (14 top-level)

```
Menu Bar (after login):
├── File          (VS Code default)
├── Edit          (VS Code default)
├── Clinical      (FROM API - 6 children)
│   ├── Prescriptions    -> /prescriptions
│   ├── Labs             -> /labs
│   ├── Immunizations    -> /immunizations
│   ├── Referrals        -> /referrals
│   ├── Authorizations   -> /authorizations
│   └── Care Plans       -> /care-plans
├── Operations    (FROM API - 5 children)
│   ├── Recall           -> /recall
│   ├── Codes            -> /codes
│   ├── Inventory        -> /inventory-management
│   ├── Payments         -> /payments
│   └── Claim Management -> /patients/claim-management
├── System        (FROM API - 7 children)
│   ├── Clinical Alerts  -> /cds
│   ├── Consents         -> /consents
│   ├── Notifications    -> /notifications
│   ├── Fax              -> /fax
│   ├── Doc Scanning     -> /document-scanning
│   ├── Check-in Kiosk   -> /kiosk
│   └── Audit Log        -> /admin/audit-log
├── Portal Mgmt   (FROM API - 1 child)
│   └── Document Reviews -> /document-reviews
├── Settings      (FROM API - 3 children)
│   ├── General          -> /settings
│   ├── Layout           -> /settings/layout-settings
│   └── Portal           -> /settings/portal-settings
├── View          (VS Code default)
├── Go            (VS Code default)
├── Admin         (static, admin-only)
│   ├── User Management
│   ├── Roles & Permissions
│   ├── Menu Configuration
│   ├── Chart Layout
│   ├── Encounter Form
│   ├── Calendar Colors
│   ├── Patient Portal
│   ├── Practice Info
│   └── Providers
├── Help          (VS Code default)
└── Window        (macOS native)
```

**Leaf items** (Calendar, Appointments, Patients, Encounters, Tasks, Messaging,
Reports, Ciyex Hub, Developer Portal) appear as sidebar ViewContainers, not menu
bar items (since they have no children).

## How It Works

### Startup Flow

```
1. App launches
2. VS Code default menus render (File, Edit, View, Go, Help)
3. Static menus hidden (Selection, Terminal, Run) via ContextKeys
4. Admin menu registered (static, gated by ciyex.role.admin)
5. User logs in (auth gate)
6. CiyexMenuService.loadMenus() called
7. Fetches /api/menus/ehr-sidebar
8. Parses { items: [{ item, children }] } format
9. For each parent item (has children):
   a. Creates a new MenuId
   b. Registers it in MenubarMainMenu with 'when: ciyex.authenticated'
   c. Registers child items in the submenu
10. Dynamic menus appear in the menu bar
```

### Sidebar ViewContainers (Static Registration)

Sidebar ViewContainers (Calendar, Patients, Clinical, Messaging, Billing,
Reports) are registered at module load time because VS Code's ViewContainer
API requires static registration. These map to the leaf menu items from the API.

| Sidebar Icon | API Menu Item | ViewContainer ID |
|---|---|---|
| Calendar | Calendar (slug: /calendar) | ciyex.calendar |
| Patients | Patients (slug: /patients) | ciyex.patients |
| Clinical | Clinical (parent) | ciyex.clinical |
| Messaging | Messaging (slug: /messaging) | ciyex.messaging |
| Billing | Payments (under Operations) | ciyex.billing |
| Reports | Reports (slug: /reports) | ciyex.reports |

### Permission Gating

Menu items with `requiredPermission` are gated:
```typescript
when: ContextKeyExpr.has(`ciyex.perm.${item.requiredPermission}`)
```

Example: Messaging menu item has `requiredPermission: "messaging"` ->
only visible when `ciyex.perm.messaging` context key is true.

## Menu Customization

Admins can customize menus via:
1. **Command Palette** -> "Configure Menu" -> WebviewPanel with menu tree
2. **API**: POST/PUT/DELETE to `/api/menus/ehr-sidebar/items/{id}/hide|modify`
3. Changes take effect on next login (menus reload from API)

## Adding New Menu Items

To add a menu item that appears in the menu bar:
1. Add it in the EHR backend (via Menu Configuration UI or API)
2. Set `screenSlug` to the target route
3. If it should be a parent menu, add children
4. The CiyexMenuService will auto-register it on next login
