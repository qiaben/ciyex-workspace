# Layout Settings Migration: EHR UI -> VS Code Native

## Overview

The EHR UI's Layout Settings system has 3 main components:
1. **Tab Manager** - Manage patient chart tabs (show/hide, reorder, rename, FHIR resources)
2. **Field Config Editor** - Configure fields per tab (types, validation, FHIR mapping, options)
3. **Encounter Settings** - Configure encounter form sections

All data is stored server-side via `/api/tab-field-config/*` with a 3-level override hierarchy:
- Universal Default → Practice Type Default → Org Custom

## VS Code Implementation Approach

Each of the 3 components becomes a **WebviewPanel editor** opened via commands.
The webview renders an interactive HTML page with the full editor UI.

### Architecture

```
Command Palette / Ciyex Menu / Gear Menu
    |
    v
WebviewPanel opens as editor tab
    |
    v
HTML/JS rendered inside webview with:
  - Fetch calls to Ciyex API (auth headers from localStorage)
  - Interactive form with sections, fields, drag-drop
  - Save/Reset/Preview buttons
  - JSON code editor toggle
```

## API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/tab-field-config/layout` | GET | Load tab layout (categories + tabs) |
| `/api/tab-field-config/layout` | PUT | Save tab layout |
| `/api/tab-field-config/layout` | DELETE | Reset to defaults |
| `/api/tab-field-config/tabs` | GET | List available tabs |
| `/api/tab-field-config/{tabKey}` | GET | Load field config for tab |
| `/api/tab-field-config/{tabKey}` | PUT | Save field config |
| `/api/tab-field-config/{tabKey}` | DELETE | Reset field config |
| `/api/tab-field-config/all` | GET | List all configs |
| `/api/tab-field-config/encounter-form` | GET | Load encounter config |
| `/api/tab-field-config/encounter-form` | PUT | Save encounter config |
| `/api/tab-field-config/encounter-form` | DELETE | Reset encounter config |

## Data Models

### Tab Layout
```typescript
interface TabCategory {
    label: string;           // "Overview", "Clinical", "Claims"
    position: number;
    tabs: TabItem[];
}

interface TabItem {
    key: string;             // "demographics", "vitals"
    label: string;           // "Demographics", "Vitals"
    icon: string;            // Lucide icon name
    visible: boolean;
    position: number;
    fhirResources?: Array<{ type: string }>;
}
```

### Field Config
```typescript
interface FieldConfig {
    sections: SectionDef[];
    features?: { fileUpload?: {...}, rowLink?: {...} };
    singleton?: boolean;
}

interface SectionDef {
    key: string;
    title: string;
    columns?: number;        // 1-4
    collapsible?: boolean;
    collapsed?: boolean;
    visible?: boolean;
    fields: FieldDef[];
}

interface FieldDef {
    key: string;
    label: string;
    type: "text" | "select" | "date" | "lookup" | ... (27 types);
    required?: boolean;
    colSpan?: number;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
    fhirMapping?: { resource: string; path: string; type: string };
    validation?: { min?, max?, minLength?, maxLength?, pattern? };
    showWhen?: { field: string; equals?: string };
}
```

## Implementation Checklist

### Phase 1: Tab Manager WebviewPanel
- [ ] Create `ciyex.openChartLayout` command (already exists as placeholder)
- [ ] Build Tab Manager HTML with interactive UI:
  - [ ] Category list with expand/collapse
  - [ ] Tab list per category with visibility toggles
  - [ ] Reorder tabs (up/down buttons)
  - [ ] Reorder categories (up/down buttons)
  - [ ] Edit tab inline (label, icon, key)
  - [ ] Add/remove tabs
  - [ ] Add/remove categories
  - [ ] Move tab between categories
  - [ ] Config source badge (Custom/Practice/Universal)
  - [ ] Save Changes button (PUT /api/tab-field-config/layout)
  - [ ] Reset to Defaults button (DELETE /api/tab-field-config/layout)
- [ ] API integration: GET/PUT/DELETE /api/tab-field-config/layout
- [ ] Webview message passing for API calls (postMessage bridge)

### Phase 2: Field Config Editor WebviewPanel
- [ ] Create `ciyex.openFieldConfig` command
- [ ] Build Field Config HTML:
  - [ ] Tab selector dropdown
  - [ ] Section list with expand/collapse
  - [ ] Add/remove/reorder sections
  - [ ] Section properties (title, columns 1-4, collapsible, collapsed)
  - [ ] Field list per section
  - [ ] Add/remove/reorder fields
  - [ ] Field editor form:
    - [ ] Key, Label, Type selector (27 types)
    - [ ] ColSpan (1-4)
    - [ ] Required checkbox
    - [ ] Placeholder text
    - [ ] FHIR Mapping (resource, path, type)
    - [ ] Options editor (for select/radio types)
    - [ ] Lookup config (for lookup type)
    - [ ] Validation rules (min, max, pattern)
    - [ ] Conditional visibility (showWhen)
  - [ ] Save/Reset buttons
  - [ ] Preview mode (render form from config)
- [ ] API integration: GET/PUT/DELETE /api/tab-field-config/{tabKey}

### Phase 3: Encounter Settings WebviewPanel
- [ ] Create `ciyex.openEncounterSettings` command (already exists)
- [ ] Build Encounter Settings HTML:
  - [ ] Section table with visibility toggles
  - [ ] Reorder sections (up/down)
  - [ ] Search/filter sections
  - [ ] Columns selector (1-4) per section
  - [ ] Collapsible toggle per section
  - [ ] Default collapsed toggle per section
  - [ ] Expandable row showing fields
  - [ ] Save/Reset buttons
  - [ ] Config source badge
- [ ] API integration: GET/PUT/DELETE /api/tab-field-config/encounter-form

### Phase 4: JSON Code Editor
- [ ] Toggle JSON view alongside visual editor (split pane)
- [ ] Syntax highlighting (Prism.js or Monaco in webview)
- [ ] Live validation (sections array, field keys, types)
- [ ] Dirty indicator
- [ ] Save from code editor

### Phase 5: Webview-API Bridge
- [ ] Create message passing system:
  - Webview sends: `{ type: 'api', method: 'GET', path: '/api/...' }`
  - Host receives, calls CiyexApiService, sends response back
  - Webview receives: `{ type: 'apiResponse', data: {...} }`
- [ ] Handle auth token refresh during editing
- [ ] Error handling for API failures
- [ ] Unsaved changes warning on close

### Phase 6: Integration
- [ ] Register commands in Command Palette
- [ ] Add to Ciyex menu (Settings section already in gear)
- [ ] Add to Admin menu bar
- [ ] Permission gating (admin-only)
