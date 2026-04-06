# .ciyex Configuration System Design

## Philosophy

The `.ciyex/` folder follows the same pattern as `.vscode/settings.json` — JSON files on disk that are:
- **Editable in Monaco** with full IntelliSense, validation, and formatting
- **Toggled between Visual UI and JSON** exactly like VS Code's Settings (Cmd+,) vs settings.json
- **Downloaded from API on startup** and cached locally
- **Auto-uploaded to API on save** (admin only)
- **Read-only for non-admins** (enforced at editor level)
- **File-watched** for external changes (same as VS Code watches settings.json)

This replaces ALL custom WebviewPanel settings editors with VS Code-native patterns.

---

## File Structure

```
.ciyex/
  settings.json          # General EHR settings (practice, display, features, session)
  layout.json            # Chart tab layout — categories, tabs, visibility, ordering
  fields/
    demographics.json    # Field config for demographics tab
    vitals.json          # Field config for vitals tab
    {tabKey}.json        # One file per tab — dynamic from layout.json
  encounter.json         # Encounter form section config
  menu.json              # Sidebar + menu bar navigation items
  colors.json            # Calendar color assignments (visit types, providers, locations)
  portal.json            # Patient portal config (branding, features, forms, navigation)
  roles.json             # Roles with FHIR SMART scopes + feature permissions (admin only)
  schemas/
    fhir-resources.json  # FHIR resource type definitions (auto-generated, read-only)
```

---

## File Schemas

### settings.json

Mirrors VS Code's settings.json pattern. Flat key-value with dot-notation grouping. Registered via `IConfigurationRegistry` so they appear in Cmd+, Settings UI.

```jsonc
{
  // ── Practice ──────────────────────────────────────
  "ciyex.practice.name": "Sunrise Medical Group",
  "ciyex.practice.npi": "1234567890",
  "ciyex.practice.address": "123 Health Ave",
  "ciyex.practice.city": "Austin",
  "ciyex.practice.state": "TX",
  "ciyex.practice.zip": "78701",
  "ciyex.practice.phone": "(512) 555-0100",
  "ciyex.practice.fax": "(512) 555-0101",
  "ciyex.practice.email": "info@sunrisemedical.com",
  "ciyex.practice.timezone": "America/Chicago",
  "ciyex.practice.taxId": "12-3456789",

  // ── Display ───────────────────────────────────────
  "ciyex.display.fontSize": 13,
  "ciyex.display.compactMode": false,
  "ciyex.display.showAvatars": true,
  "ciyex.display.dateFormat": "MM/DD/YYYY",
  "ciyex.display.timeFormat": "12h",

  // ── Calendar ──────────────────────────────────────
  "ciyex.calendar.defaultView": "week",
  "ciyex.calendar.startHour": 8,
  "ciyex.calendar.endHour": 18,
  "ciyex.calendar.slotDuration": 15,
  "ciyex.calendar.colorBy": "visitType",

  // ── Session ───────────────────────────────────────
  "ciyex.session.idleTimeoutMinutes": 30,
  "ciyex.session.warningMinutes": 5,
  "ciyex.session.autoRefreshToken": true,
  "ciyex.session.loginRequired": true,

  // ── Features ──────────────────────────────────────
  "ciyex.features.cdsHooksEnabled": true,
  "ciyex.features.smartLaunchEnabled": true,
  "ciyex.features.patientPortalEnabled": true,
  "ciyex.features.telehealthEnabled": false,
  "ciyex.features.kioskEnabled": false,

  // ── Server (read-only, set by deploy) ─────────────
  "ciyex.server.apiUrl": "https://api-dev.ciyex.org",
  "ciyex.server.environment": "development"
}
```

**API mapping:**
- `ciyex.practice.*` → `GET/PUT /api/practice`
- `ciyex.display.*` → `GET/PUT /api/settings/display`
- `ciyex.calendar.*` → `GET/PUT /api/settings/calendar`
- `ciyex.session.*` → local only (VS Code settings)
- `ciyex.features.*` → `GET/PUT /api/settings/features`
- `ciyex.server.*` → local only (VS Code settings)

---

### layout.json

Defines patient chart tab organization. Each category contains ordered tabs, each tab references FHIR resources and has a corresponding `fields/{tabKey}.json` for its form definition.

```jsonc
{
  "$schema": "./schemas/layout.schema.json",
  "source": "ORG_CUSTOM",  // "UNIVERSAL_DEFAULT" | "PRACTICE_TYPE_DEFAULT" | "ORG_CUSTOM"
  "categories": [
    {
      "key": "patient-info",
      "label": "Patient Information",
      "position": 0,
      "tabs": [
        {
          "key": "demographics",
          "label": "Demographics",
          "icon": "User",
          "position": 0,
          "visible": true,
          "fhirResources": ["Patient"]
        },
        {
          "key": "insurance",
          "label": "Insurance",
          "icon": "Shield",
          "position": 1,
          "visible": true,
          "fhirResources": ["Coverage", "Organization"]
        }
      ]
    },
    {
      "key": "clinical",
      "label": "Clinical",
      "position": 1,
      "tabs": [
        {
          "key": "vitals",
          "label": "Vitals",
          "icon": "Activity",
          "position": 0,
          "visible": true,
          "fhirResources": ["Observation"]
        },
        {
          "key": "conditions",
          "label": "Conditions",
          "icon": "AlertCircle",
          "position": 1,
          "visible": true,
          "fhirResources": ["Condition"]
        },
        {
          "key": "medications",
          "label": "Medications",
          "icon": "Pill",
          "position": 2,
          "visible": true,
          "fhirResources": ["MedicationRequest"]
        },
        {
          "key": "allergies",
          "label": "Allergies",
          "icon": "AlertTriangle",
          "position": 3,
          "visible": true,
          "fhirResources": ["AllergyIntolerance"]
        },
        {
          "key": "immunizations",
          "label": "Immunizations",
          "icon": "Syringe",
          "position": 4,
          "visible": true,
          "fhirResources": ["Immunization"]
        },
        {
          "key": "labs",
          "label": "Lab Results",
          "icon": "TestTube",
          "position": 5,
          "visible": true,
          "fhirResources": ["DiagnosticReport", "Observation"]
        },
        {
          "key": "procedures",
          "label": "Procedures",
          "icon": "Stethoscope",
          "position": 6,
          "visible": true,
          "fhirResources": ["Procedure"]
        }
      ]
    },
    {
      "key": "documents",
      "label": "Documents & Plans",
      "position": 2,
      "tabs": [
        {
          "key": "documents",
          "label": "Documents",
          "icon": "FileText",
          "position": 0,
          "visible": true,
          "fhirResources": ["DocumentReference"]
        },
        {
          "key": "care-plans",
          "label": "Care Plans",
          "icon": "ClipboardList",
          "position": 1,
          "visible": true,
          "fhirResources": ["CarePlan"]
        }
      ]
    }
  ]
}
```

**API mapping:** `GET/PUT /api/tab-field-config/layout` | `DELETE` to reset

---

### fields/{tabKey}.json

One file per tab. Defines sections, fields, types, FHIR mappings, and validation. This is where **dynamic forms are built from FHIR resources**.

```jsonc
// fields/demographics.json
{
  "$schema": "../schemas/fields.schema.json",
  "tabKey": "demographics",
  "fhirResources": ["Patient"],
  "sections": [
    {
      "key": "name",
      "title": "Patient Name",
      "columns": 2,
      "visible": true,
      "collapsible": false,
      "fields": [
        {
          "key": "firstName",
          "label": "First Name",
          "type": "text",
          "required": true,
          "colSpan": 1,
          "placeholder": "First name",
          "fhirMapping": {
            "resource": "Patient",
            "path": "name[0].given[0]",
            "type": "string"
          }
        },
        {
          "key": "lastName",
          "label": "Last Name",
          "type": "text",
          "required": true,
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Patient",
            "path": "name[0].family",
            "type": "string"
          }
        },
        {
          "key": "middleName",
          "label": "Middle Name",
          "type": "text",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Patient",
            "path": "name[0].given[1]",
            "type": "string"
          }
        },
        {
          "key": "suffix",
          "label": "Suffix",
          "type": "select",
          "colSpan": 1,
          "options": [
            { "label": "Jr.", "value": "Jr." },
            { "label": "Sr.", "value": "Sr." },
            { "label": "II", "value": "II" },
            { "label": "III", "value": "III" },
            { "label": "IV", "value": "IV" }
          ],
          "fhirMapping": {
            "resource": "Patient",
            "path": "name[0].suffix[0]",
            "type": "string"
          }
        }
      ]
    },
    {
      "key": "demographics",
      "title": "Demographics",
      "columns": 3,
      "visible": true,
      "collapsible": true,
      "collapsed": false,
      "fields": [
        {
          "key": "dateOfBirth",
          "label": "Date of Birth",
          "type": "date",
          "required": true,
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Patient",
            "path": "birthDate",
            "type": "date"
          }
        },
        {
          "key": "gender",
          "label": "Gender",
          "type": "select",
          "required": true,
          "colSpan": 1,
          "options": [
            { "label": "Male", "value": "male" },
            { "label": "Female", "value": "female" },
            { "label": "Other", "value": "other" },
            { "label": "Unknown", "value": "unknown" }
          ],
          "fhirMapping": {
            "resource": "Patient",
            "path": "gender",
            "type": "code"
          }
        },
        {
          "key": "ssn",
          "label": "SSN",
          "type": "ssn",
          "colSpan": 1,
          "placeholder": "XXX-XX-XXXX",
          "fhirMapping": {
            "resource": "Patient",
            "path": "identifier[?system=http://hl7.org/fhir/sid/us-ssn].value",
            "type": "string"
          },
          "validation": {
            "pattern": "^\\d{3}-\\d{2}-\\d{4}$"
          }
        },
        {
          "key": "mrn",
          "label": "Medical Record Number",
          "type": "text",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Patient",
            "path": "identifier[?system=http://hospital.org/mrn].value",
            "type": "string"
          }
        },
        {
          "key": "race",
          "label": "Race",
          "type": "select",
          "colSpan": 1,
          "options": [
            { "label": "White", "value": "2106-3" },
            { "label": "Black or African American", "value": "2054-5" },
            { "label": "Asian", "value": "2028-9" },
            { "label": "American Indian or Alaska Native", "value": "1002-5" },
            { "label": "Native Hawaiian or Other Pacific Islander", "value": "2076-8" },
            { "label": "Other", "value": "2131-1" }
          ],
          "fhirMapping": {
            "resource": "Patient",
            "path": "extension[?url=http://hl7.org/fhir/us/core/StructureDefinition/us-core-race].extension[?url=ombCategory].valueCoding.code",
            "type": "code"
          }
        },
        {
          "key": "ethnicity",
          "label": "Ethnicity",
          "type": "select",
          "colSpan": 1,
          "options": [
            { "label": "Hispanic or Latino", "value": "2135-2" },
            { "label": "Not Hispanic or Latino", "value": "2186-5" }
          ],
          "fhirMapping": {
            "resource": "Patient",
            "path": "extension[?url=http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity].extension[?url=ombCategory].valueCoding.code",
            "type": "code"
          }
        }
      ]
    },
    {
      "key": "contact",
      "title": "Contact Information",
      "columns": 2,
      "visible": true,
      "collapsible": true,
      "fields": [
        {
          "key": "phone",
          "label": "Phone",
          "type": "phone",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Patient",
            "path": "telecom[?system=phone&use=home].value",
            "type": "string"
          }
        },
        {
          "key": "mobilePhone",
          "label": "Mobile Phone",
          "type": "phone",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Patient",
            "path": "telecom[?system=phone&use=mobile].value",
            "type": "string"
          }
        },
        {
          "key": "email",
          "label": "Email",
          "type": "email",
          "colSpan": 2,
          "fhirMapping": {
            "resource": "Patient",
            "path": "telecom[?system=email].value",
            "type": "string"
          }
        }
      ]
    },
    {
      "key": "address",
      "title": "Address",
      "columns": 3,
      "visible": true,
      "collapsible": true,
      "fields": [
        {
          "key": "addressLine1",
          "label": "Street Address",
          "type": "text",
          "colSpan": 3,
          "fhirMapping": {
            "resource": "Patient",
            "path": "address[0].line[0]",
            "type": "string"
          }
        },
        {
          "key": "city",
          "label": "City",
          "type": "text",
          "colSpan": 1,
          "fhirMapping": { "resource": "Patient", "path": "address[0].city", "type": "string" }
        },
        {
          "key": "state",
          "label": "State",
          "type": "select",
          "colSpan": 1,
          "options": [
            { "label": "Texas", "value": "TX" },
            { "label": "California", "value": "CA" }
          ],
          "fhirMapping": { "resource": "Patient", "path": "address[0].state", "type": "string" }
        },
        {
          "key": "zip",
          "label": "ZIP Code",
          "type": "zipcode",
          "colSpan": 1,
          "fhirMapping": { "resource": "Patient", "path": "address[0].postalCode", "type": "string" },
          "validation": { "pattern": "^\\d{5}(-\\d{4})?$" }
        }
      ]
    }
  ]
}
```

**Supported field types (27):**
`text`, `number`, `date`, `datetime`, `select`, `multiselect`, `checkbox`, `radio`, `textarea`, `phone`, `email`, `ssn`, `zipcode`, `address`, `name`, `currency`, `percentage`, `weight`, `height`, `temperature`, `bloodPressure`, `bmi`, `icd10`, `cpt`, `ndc`, `fhirReference`, `file`

**API mapping:** `GET/PUT /api/tab-field-config/{tabKey}` | `DELETE` to reset

---

### encounter.json

Encounter form section configuration. Same schema as field files but specifically for the encounter form.

```jsonc
{
  "$schema": "./schemas/fields.schema.json",
  "tabKey": "encounter-form",
  "source": "ORG_CUSTOM",
  "sections": [
    {
      "key": "chief-complaint",
      "title": "Chief Complaint",
      "columns": 1,
      "visible": true,
      "collapsible": false,
      "fields": [
        {
          "key": "chiefComplaint",
          "label": "Chief Complaint",
          "type": "textarea",
          "required": true,
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Encounter",
            "path": "reasonCode[0].text",
            "type": "string"
          }
        }
      ]
    },
    {
      "key": "vitals",
      "title": "Vitals",
      "columns": 4,
      "visible": true,
      "collapsible": true,
      "collapsed": false,
      "fields": [
        {
          "key": "temperature",
          "label": "Temperature (F)",
          "type": "temperature",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Observation",
            "path": "valueQuantity.value",
            "type": "decimal",
            "code": "8310-5",
            "system": "http://loinc.org"
          },
          "validation": { "min": 90, "max": 110 }
        },
        {
          "key": "bloodPressure",
          "label": "Blood Pressure",
          "type": "bloodPressure",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Observation",
            "path": "component",
            "type": "bp",
            "code": "85354-9",
            "system": "http://loinc.org"
          }
        },
        {
          "key": "heartRate",
          "label": "Heart Rate",
          "type": "number",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Observation",
            "path": "valueQuantity.value",
            "type": "integer",
            "code": "8867-4",
            "system": "http://loinc.org"
          },
          "validation": { "min": 30, "max": 250 }
        },
        {
          "key": "weight",
          "label": "Weight (lbs)",
          "type": "weight",
          "colSpan": 1,
          "fhirMapping": {
            "resource": "Observation",
            "path": "valueQuantity.value",
            "type": "decimal",
            "code": "29463-7",
            "system": "http://loinc.org"
          }
        }
      ]
    }
  ]
}
```

**API mapping:** `GET/PUT /api/tab-field-config/encounter-form` | `DELETE` to reset

---

### menu.json

Navigation tree for sidebar and menu bar. Defines hierarchy, icons, routes, FHIR resource requirements, and visibility.

```jsonc
{
  "$schema": "./schemas/menu.schema.json",
  "items": [
    {
      "itemKey": "calendar",
      "label": "Calendar",
      "icon": "Calendar",
      "screenSlug": "/calendar",
      "position": 0,
      "visible": true,
      "children": []
    },
    {
      "itemKey": "patients",
      "label": "Patients",
      "icon": "Users",
      "screenSlug": "/patients",
      "position": 2,
      "visible": true,
      "children": []
    },
    {
      "itemKey": "clinical",
      "label": "Clinical",
      "icon": "Stethoscope",
      "position": 5,
      "visible": true,
      "children": [
        {
          "itemKey": "prescriptions",
          "label": "Prescriptions",
          "icon": "Pill",
          "screenSlug": "/prescriptions",
          "position": 0,
          "visible": true,
          "requiredPermission": "rx.read",
          "fhirResources": ["MedicationRequest"]
        },
        {
          "itemKey": "labs",
          "label": "Labs",
          "icon": "TestTube",
          "screenSlug": "/labs",
          "position": 1,
          "visible": true,
          "requiredPermission": "orders.read",
          "fhirResources": ["DiagnosticReport", "Observation"]
        }
      ]
    }
  ]
}
```

**API mapping:** `GET /api/menus/ehr-sidebar` | CRUD on individual items

---

### colors.json

```jsonc
{
  "$schema": "./schemas/colors.schema.json",
  "visitTypes": {
    "New Patient": "#4CAF50",
    "Follow-Up": "#2196F3",
    "Sick Visit": "#FF9800",
    "Annual Physical": "#9C27B0",
    "Telehealth": "#00BCD4"
  },
  "providers": {
    "Dr. Smith": "#3F51B5",
    "Dr. Johnson": "#E91E63"
  },
  "locations": {
    "Main Office": "#607D8B",
    "Satellite Clinic": "#795548"
  }
}
```

**API mapping:** `GET/POST /api/ui-colors` | `DELETE` to reset

---

### portal.json

```jsonc
{
  "$schema": "./schemas/portal.schema.json",
  "general": {
    "name": "Sunrise Patient Portal",
    "url": "https://portal.sunrisemedical.com",
    "language": "en",
    "timezone": "America/Chicago"
  },
  "features": {
    "onlineBooking": true,
    "messaging": true,
    "labResults": true,
    "prescriptionRefills": true,
    "billPay": false,
    "formSubmission": true,
    "telehealth": false,
    "educationalContent": true
  },
  "forms": [
    {
      "id": "intake-form",
      "title": "New Patient Intake Form",
      "description": "Required for all new patients",
      "active": true,
      "fields": [
        { "key": "reason", "label": "Reason for Visit", "type": "textarea", "required": true },
        { "key": "allergies", "label": "Known Allergies", "type": "text" },
        { "key": "medications", "label": "Current Medications", "type": "textarea" },
        { "key": "pharmacy", "label": "Preferred Pharmacy", "type": "text" }
      ]
    }
  ],
  "navigation": [
    { "key": "dashboard", "label": "Dashboard", "route": "/", "icon": "Home", "visible": true },
    { "key": "appointments", "label": "Appointments", "route": "/appointments", "icon": "Calendar", "visible": true },
    { "key": "messages", "label": "Messages", "route": "/messages", "icon": "Mail", "visible": true },
    { "key": "records", "label": "Health Records", "route": "/records", "icon": "FileText", "visible": true }
  ]
}
```

**API mapping:** `GET /api/portal/config` | `PATCH /api/portal/config/{section}`

---

### roles.json (admin only)

```jsonc
{
  "$schema": "./schemas/roles.schema.json",
  "roles": [
    {
      "id": "admin",
      "name": "admin",
      "label": "Administrator",
      "description": "Full system access",
      "isSystem": true,
      "smartScopes": [
        "Patient.read", "Patient.write",
        "Encounter.read", "Encounter.write",
        "Observation.read", "Observation.write",
        "MedicationRequest.read", "MedicationRequest.write",
        "Condition.read", "Condition.write",
        "Procedure.read", "Procedure.write",
        "AllergyIntolerance.read", "AllergyIntolerance.write"
      ],
      "permissions": [
        "patients.view", "patients.create", "patients.edit", "patients.delete",
        "encounters.view", "encounters.create", "encounters.edit",
        "clinical.view", "clinical.create", "clinical.edit",
        "scheduling.view", "scheduling.create", "scheduling.edit", "scheduling.delete",
        "billing.view", "billing.create", "billing.edit",
        "admin.view", "admin.create", "admin.edit", "admin.delete"
      ]
    },
    {
      "id": "physician",
      "name": "physician",
      "label": "Physician",
      "description": "Clinical provider with chart access",
      "isSystem": false,
      "smartScopes": [
        "Patient.read", "Patient.write",
        "Encounter.read", "Encounter.write",
        "Observation.read", "Observation.write",
        "MedicationRequest.read", "MedicationRequest.write",
        "Condition.read", "Condition.write"
      ],
      "permissions": [
        "patients.view", "patients.create", "patients.edit",
        "encounters.view", "encounters.create", "encounters.edit",
        "clinical.view", "clinical.create", "clinical.edit",
        "scheduling.view"
      ]
    }
  ]
}
```

**API mapping:** `GET /api/admin/roles` | CRUD operations

---

## Storage: S3 via ciyex-files SDK

All `.ciyex/` config files are stored in **S3** via the existing `ciyex-files` microservice. The EHR backend proxies through `/api/files-proxy` with key-based operations.

### S3 Key Structure

```
{orgAlias}/config/workspace/
  settings.json
  layout.json
  encounter.json
  menu.json
  colors.json
  portal.json
  roles.json
  fields/
    demographics.json
    vitals.json
    conditions.json
    ... (one per tab from layout.json)
  schemas/
    fhir-resources.json
```

**Key pattern:** `{orgAlias}/config/workspace/{filePath}`

### API Endpoints Used

All operations go through the EHR backend's `FileStorageProxyController` which routes to `ciyex-files` (S3):

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| **Download file** | `GET /api/files-proxy/by-key/download?key={orgAlias}/config/workspace/{file}` | Fetch config JSON from S3 |
| **Check exists** | `HEAD /api/files-proxy/by-key/exists?key={orgAlias}/config/workspace/{file}` | Check if config exists |
| **Upload file** | `POST /api/files-proxy/store-bytes` | Store config JSON to S3 (admin only) |
| **Delete file** | `DELETE /api/files-proxy/by-key?key={orgAlias}/config/workspace/{file}` | Reset to defaults |
| **Get presigned URL** | `GET /api/files-proxy/by-key/presigned-url?key={key}` | Direct S3 download (optional, for bulk) |

### store-bytes Request Format

```typescript
POST /api/files-proxy/store-bytes
Content-Type: application/json

{
  "key": "{orgAlias}/config/workspace/layout.json",
  "contentType": "application/json",
  "data": "<base64-encoded JSON content>",
  "sourceService": "ciyex-workspace",
  "filename": "layout.json"
}
```

---

## Architecture: How It Works

### Startup Flow

```
App Launch → Auth completes → CiyexConfigService.initialize()
  |
  | (parallel downloads from S3 via /api/files-proxy/by-key/download)
  |
  +──→ GET .../config/workspace/settings.json    → write .ciyex/settings.json
  +──→ GET .../config/workspace/layout.json      → write .ciyex/layout.json
  +──→ GET .../config/workspace/encounter.json   → write .ciyex/encounter.json
  +──→ GET .../config/workspace/menu.json        → write .ciyex/menu.json
  +──→ GET .../config/workspace/colors.json      → write .ciyex/colors.json
  +──→ GET .../config/workspace/portal.json      → write .ciyex/portal.json
  +──→ GET .../config/workspace/roles.json       → write .ciyex/roles.json (admin only)
  +──→ GET .../config/workspace/fields/*.json    → write .ciyex/fields/*.json
  |
  | (if file not found in S3, use built-in defaults)
  |
  v
File watchers registered on all .ciyex/*.json files
  |
  v
UI renders from local JSON files (instant, no network latency)
```

### Edit Flow (Admin Saves → S3)

```
Admin opens .ciyex/layout.json in Monaco (or edits via Visual UI)
  |
  v
Admin edits and saves (Cmd+S)
  |
  v
File watcher detects change → CiyexConfigService.onDidFileChange('layout.json')
  |
  +──→ 1. Validate JSON against schema
  +──→ 2. POST /api/files-proxy/store-bytes  (upload to S3)
  |        key: "{orgAlias}/config/workspace/layout.json"
  |        data: base64(file content)
  +──→ 3. Fire onDidChangeConfiguration event
  |
  v
All UI consumers re-render from updated config
Other users get updated config on next app launch (downloads from S3)
```

### Read Flow (Non-Admin)

```
Non-admin opens .ciyex/layout.json
  |
  v
Monaco opens file as READ-ONLY (editor.readOnly = true)
  |
  v
User can view JSON with IntelliSense but cannot edit
  |
  v
Visual Settings UI shows all controls as disabled
```

### Defaults & Reset Flow

```
Config file not found in S3
  |
  v
CiyexConfigService writes built-in default JSON to .ciyex/
  |
  v
Admin clicks "Reset to Defaults"
  |
  +──→ DELETE /api/files-proxy/by-key?key={orgAlias}/config/workspace/layout.json
  +──→ Write built-in default to .ciyex/layout.json
  +──→ Fire onDidChangeConfiguration
```

### Multi-User Sync

```
Admin A saves layout.json on Machine 1
  |
  v
Uploaded to S3: {orgAlias}/config/workspace/layout.json
  |
  v
User B launches app on Machine 2
  |
  v
Downloads latest layout.json from S3
  |
  v
User B sees Admin A's changes
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **S3 via ciyex-files SDK** | Existing infrastructure, org-scoped, auditable, scalable |
| **Files on disk (.ciyex/)** | Enables Monaco editor, file watchers, git diffing |
| **Download on every startup** | Guarantees local = server state (no stale cache) |
| **Upload on admin save** | Changes propagate to all org users via S3 |
| **Key-based S3 operations** | No database records needed — pure file storage |
| **`{orgAlias}/config/workspace/`** | Org-scoped, separate from patient/clinical files |
| **One file per concern** | Parallel editing, smaller uploads, clearer diffs |
| **fields/ subdirectory** | Could be 20+ tab configs — keeps root clean |
| **JSON with $schema** | IntelliSense, validation, hover docs in Monaco |
| **Built-in defaults fallback** | Works offline and on first launch before any S3 config |
| **Read-only for non-admins** | Enforced at editor level via ContextKey |

## VS Code Integration Points

| Pattern | How We Use It |
|---------|---------------|
| **IConfigurationRegistry** | Register all `ciyex.*` settings for Cmd+, UI |
| **IFileService.watch()** | Watch `.ciyex/` folder for changes |
| **IEditorService.openEditor()** | Open JSON files in Monaco editor |
| **JSON Language Service** | Schema validation via `$schema` references |
| **EditorTitle menu** | "Open Settings (JSON)" / "Open Settings (UI)" toggle |
| **ContextKeyExpr** | `ciyex.role.admin` gates edit vs read-only |
| **ITextFileEditorModel** | Mark files as read-only for non-admins |
| **ConfigurationTarget.WORKSPACE** | `.ciyex/settings.json` acts as workspace config |

---

## S3 Storage Integration Details

### Existing Infrastructure

| Component | Location | Purpose |
|-----------|----------|---------|
| **ciyex-files** | `/Users/siva/ciyex-workspace/ciyex-files` | Standalone S3 microservice (Spring Boot + AWS SDK S3 2.31.1) |
| **ciyex-platform-sdk** | Maven `org.ciyex:ciyex-platform-sdk:0.1.1` | `CiyexFilesClient` for service-to-service calls |
| **FileStorageProxyController** | `ciyex/controller/FileStorageProxyController.java` | EHR backend proxy at `/api/files-proxy` |
| **VaultikStorageStrategy** | `ciyex/service/storage/VaultikStorageStrategy.java` | Routes proxy calls to ciyex-files |
| **S3ClientProvider** | `ciyex/provider/S3ClientProvider.java` | Per-tenant S3 client (credentials from Vault) |

### New Backend Endpoint (Recommended)

Add a dedicated config endpoint to the EHR backend that wraps the files-proxy for workspace config:

```java
@RestController
@RequestMapping("/api/workspace-config")
public class WorkspaceConfigController {

    @GetMapping("/{**path}")
    public ResponseEntity<byte[]> downloadConfig(@PathVariable String path) {
        // key = "{orgAlias}/config/workspace/{path}"
        // Delegates to FileStorageStrategy.downloadByKey()
        // Returns JSON content
    }

    @PutMapping("/{**path}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> uploadConfig(@PathVariable String path, @RequestBody byte[] content) {
        // key = "{orgAlias}/config/workspace/{path}"
        // Validates JSON
        // Delegates to FileStorageStrategy.uploadByKey()
    }

    @DeleteMapping("/{**path}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> resetConfig(@PathVariable String path) {
        // Deletes from S3, returns 204
    }

    @GetMapping("/manifest")
    public ResponseEntity<ConfigManifest> getManifest() {
        // Returns list of all config files with lastModified timestamps
        // Client uses this to know which files to download
    }
}
```

**Simplified client calls from Ciyex Workspace:**

```typescript
// Download
GET /api/workspace-config/layout.json → { categories: [...] }

// Upload (admin)
PUT /api/workspace-config/layout.json
Body: { categories: [...] }

// Reset (admin)
DELETE /api/workspace-config/layout.json

// Manifest (check what exists + timestamps)
GET /api/workspace-config/manifest
→ { files: [{ path: "layout.json", lastModified: "2026-04-06T..." }, ...] }
```

---

## FHIR Resource Mapping Summary

The `fhirMapping` field in each form field connects the UI to FHIR resources:

```typescript
{
  "resource": "Patient",           // FHIR resource type
  "path": "name[0].given[0]",     // FHIRPath expression to the value
  "type": "string",               // Expected FHIR data type
  "code": "8310-5",               // (optional) LOINC/SNOMED code for Observations
  "system": "http://loinc.org"    // (optional) Code system URI
}
```

**Supported FHIR Resources (18):**
Patient, Encounter, Observation, Condition, Procedure, MedicationRequest, AllergyIntolerance, Immunization, DiagnosticReport, CarePlan, DocumentReference, Appointment, Schedule, Practitioner, Organization, Location, Claim, Coverage

**Path expressions use FHIRPath-like syntax:**
- `name[0].given[0]` — first given name
- `telecom[?system=phone&use=home].value` — home phone (filtered)
- `identifier[?system=http://hl7.org/fhir/sid/us-ssn].value` — SSN identifier
- `extension[?url=...].valueCoding.code` — US Core extensions
- `component` — for compound types like blood pressure

---

## Next Steps

1. **Add `WorkspaceConfigController`** to EHR backend — wraps ciyex-files for `/api/workspace-config/*`
2. **Create `ICiyexConfigService`** in workspace — downloads from S3, writes to `.ciyex/`, watches, uploads on save
3. **Register JSON schemas** — for IntelliSense in Monaco
4. **Register IConfigurationRegistry entries** — for `settings.json` keys in Cmd+, UI
5. **Add EditorTitle toggle** — "Open Layout (JSON)" button in visual editors
6. **Remove existing WebviewPanel settings** — replace with file-based editors
7. **Add read-only enforcement** — for non-admin users via ContextKey
8. **Seed default configs** — ship built-in defaults for first-launch experience
