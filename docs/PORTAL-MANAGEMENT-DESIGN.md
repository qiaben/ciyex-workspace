# Portal Management — Design Document

> **Date:** 2026-04-09
> **Status:** DRAFT

---

## 1. Overview

Portal Management is the admin interface for configuring and managing the **patient portal** (`ciyex-portal-ui`). Staff use it to manage portal settings, forms, document reviews, access requests, and templates. All features exist in the current EHR UI (`ciyex-ehr-ui`) and need to be ported to native VS Code EditorPanes in Ciyex Workspace.

---

## 2. Current State (ciyex-ehr-ui)

### 2.1 Screens

| Screen | Route | Purpose |
|--------|-------|---------|
| Portal Settings | `/settings/portal-settings` | Branding, features, navigation |
| Form Builder | `/settings/portal-settings` (forms tab) | Create/edit intake/consent forms |
| Document Reviews | (sidebar) | Review patient-uploaded documents |
| Access Requests | (sidebar) | Approve/deny portal registration |
| Template Documents | `/settings/templateDocument` | HTML templates for portal |
| Form Submissions | (patient chart tab) | Review patient form responses |

### 2.2 Backend Entities

| Entity | Table | Key Fields |
|--------|-------|------------|
| `PortalConfig` | `portal_config` | orgAlias, config (JSON: general, features, navigation) |
| `PortalForm` | `portal_form` | formKey, formType, title, fieldConfig (JSON), active, position |
| `PortalFormSubmission` | `portal_form_submission` | patientId, formId, responseData (JSON), status (pending/accepted/rejected) |
| `DocumentReview` | `document_review` | patientId, fileName, status (PENDING/ACCEPTED/REJECTED), category |
| `PortalAccessRequest` | `portal_access_request` | patientName, email, status (pending/approved/denied) |
| `PortalNotification` | `portal_notification` | patientId, type, title, message |
| `TemplateDocument` | `template_document` | name, context (ENCOUNTER/PORTAL), content (HTML) |

### 2.3 API Endpoints

```
Portal Config:
  GET    /api/portal/config                    → Full portal configuration
  PUT    /api/portal/config                    → Save all config
  PATCH  /api/portal/config/{section}          → Update section (general/features/navigation)

Forms:
  GET    /api/portal/config/forms              → List forms
  POST   /api/portal/config/forms              → Create form
  PUT    /api/portal/config/forms/{id}         → Update form
  DELETE /api/portal/config/forms/{id}         → Delete form
  PATCH  /api/portal/config/forms/{id}/toggle  → Toggle active

Form Submissions:
  GET    /api/portal/form-submissions          → All submissions
  GET    /api/portal/form-submissions/pending  → Pending only
  PUT    /api/portal/form-submissions/{id}/accept → Accept
  PUT    /api/portal/form-submissions/{id}/reject → Reject with reason

Document Reviews:
  GET    /api/portal/document-reviews/pending  → Pending documents
  PUT    /api/portal/document-reviews/{id}/accept → Accept
  PUT    /api/portal/document-reviews/{id}/reject → Reject
  GET    /api/portal/document-reviews/{id}/preview → Download preview

Access Requests:
  GET    /api/portal/requests                  → List requests (paginated)
  POST   /api/portal/requests/{id}/approve     → Approve
  POST   /api/portal/requests/{id}/deny        → Deny with reason
  GET    /api/portal/requests/stats            → Stats (pending/approved/denied counts)

Templates:
  GET    /api/template-documents?context=PORTAL → List portal templates
  POST   /api/template-documents               → Create template
  PUT    /api/template-documents/{id}           → Update template
  DELETE /api/template-documents/{id}           → Delete template
```

---

## 3. Design: Sidebar + EditorPanes

### 3.1 Layout

The `ciyex.portal-management` sidebar container already exists. It needs ViewPanes for each sub-feature, and EditorPanes for detailed views.

```
┌──────────┬──────────────────────────────────────────────────────┐
│ PORTAL   │  📅 Calendar  ×  │  ⚙️ Portal Settings  ×            │
│ MGMT     ├──────────────────────────────────────────────────────┤
│          │                                                       │
│ DOC      │  Portal Settings                                     │
│ REVIEWS  │  ═══════════════════════════════════════════════════  │
│ 📄 3     │                                                       │
│ pending  │  GENERAL                                              │
│          │  ─────────────────────────────                        │
│ ACCESS   │  Portal Name     [Patient Portal           ]         │
│ REQUESTS │  Language         [English                ▼]         │
│ 👤 2     │  Timezone         [America/New_York       ▼]         │
│ pending  │                                                       │
│          │  FEATURES                                             │
│ FORM     │  ─────────────────────────────                        │
│ SUBMITS  │  [✓] Online Booking    [✓] Messaging                 │
│ 📝 5     │  [✓] Lab Results       [ ] Prescription Refills      │
│ pending  │  [✓] Bill Pay          [✓] Form Submission           │
│          │  [✓] Telehealth        [✓] Educational Content       │
│ FORMS    │                                                       │
│ 📋 4     │  NAVIGATION                                          │
│ active   │  ─────────────────────────────                        │
│          │  Dashboard   /dashboard    Home    [✓] visible       │
│ TEMPLATES│  Appointments /appointments Calendar [✓] visible     │
│ 📝 2     │  Messages    /messages     Mail     [✓] visible      │
│          │  ...                                                  │
│          │                                     [Save Changes]    │
└──────────┴──────────────────────────────────────────────────────┘
```

### 3.2 Component Architecture

```
Sidebar (ciyex.portal-management):
├── DocumentReviewPane (ViewPane)     → List pending documents
├── AccessRequestPane (ViewPane)      → List pending access requests
├── FormSubmissionPane (ViewPane)     → List pending form submissions
├── PortalFormsPane (ViewPane)        → List forms (active/inactive)
└── TemplatesPane (ViewPane)          → List templates

Editors (click sidebar item → opens in editor area):
├── PortalSettingsEditor (EditorPane) → General/Features/Navigation config
├── FormBuilderEditor (EditorPane)    → Edit individual form fields
├── DocumentPreviewEditor (EditorPane)→ Preview uploaded document
├── TemplateEditor (EditorPane)       → HTML template editor
└── SubmissionReviewEditor (EditorPane)→ Review form submission data
```

### 3.3 Sidebar Panes

#### Document Reviews Pane
- List from `GET /api/portal/document-reviews/pending`
- Each item: patient name, file name, category, upload date
- Click → opens document preview in editor
- Action buttons: Accept (✓), Reject (✗) with reason prompt

#### Access Requests Pane
- List from `GET /api/portal/requests?status=pending`
- Each item: patient name, email, DOB, request date
- Action buttons: Approve (✓), Deny (✗) with reason prompt
- Stats badge showing pending count

#### Form Submissions Pane
- List from `GET /api/portal/form-submissions/pending`
- Each item: patient name, form title, submitted date
- Click → opens submission review editor showing form data
- Action buttons: Accept (✓), Reject (✗)

#### Portal Forms Pane
- List from `GET /api/portal/config/forms`
- Each item: form title, type (intake/consent/custom), active toggle
- Click → opens form builder editor
- + button → create new form

#### Templates Pane
- List from `GET /api/template-documents?context=PORTAL`
- Each item: template name, last updated
- Click → opens template editor
- + button → create new template

### 3.4 Editor Panes

#### Portal Settings Editor
- Loads from `GET /api/portal/config`
- Three sections: General, Features, Navigation
- General: name, language, timezone inputs
- Features: toggle switches for each feature
- Navigation: ordered list of menu items (key, label, route, icon, visible)
- Save button → `PUT /api/portal/config`

#### Form Builder Editor
- Loads specific form from `GET /api/portal/config/forms`
- Form metadata: title, type, description, active toggle
- Field config: dynamic field list with type/label/required/options
- Drag-and-drop reorder
- Save → `PUT /api/portal/config/forms/{id}`

#### Submission Review Editor
- Loads submission from `GET /api/portal/form-submissions/{id}`
- Shows form title + patient name
- Renders submitted data as read-only key-value pairs
- Accept/Reject buttons at top
- Reviewer notes textarea

---

## 4. Implementation Files

```
src/vs/workbench/contrib/ciyexEhr/browser/
├── portal/
│   ├── documentReviewPane.ts         # Sidebar: pending document reviews
│   ├── accessRequestPane.ts          # Sidebar: pending access requests
│   ├── formSubmissionPane.ts         # Sidebar: pending form submissions
│   ├── portalFormsPane.ts            # Sidebar: form list
│   ├── templatesPane.ts              # Sidebar: template list
│   └── portalTypes.ts                # TypeScript interfaces
├── editors/
│   ├── portalSettingsEditor.ts       # Editor: portal config
│   ├── formBuilderEditor.ts          # Editor: form field config
│   └── portalEditorInput.ts          # EditorInputs for portal editors
```

---

## 5. Implementation Phases

### Phase 1: Settings Editor + Sidebar Panes (1 week)
- [ ] `PortalSettingsEditorInput` + `PortalSettingsEditor`
- [ ] General/Features/Navigation sections with save
- [ ] `DocumentReviewPane` with accept/reject
- [ ] `AccessRequestPane` with approve/deny
- [ ] `FormSubmissionPane` with accept/reject
- [ ] Replace existing GenericListPane entries
- [ ] `ciyex.openPortalSettings` command

### Phase 2: Form Builder + Templates (1 week)
- [ ] `PortalFormsPane` with form list + active toggle
- [ ] `FormBuilderEditor` with field config
- [ ] `TemplatesPane` with template list
- [ ] `TemplateEditor` with HTML editor
- [ ] Create/edit/delete forms
- [ ] Create/edit/delete templates

### Phase 3: Polish (3 days)
- [ ] Sidebar badges (pending counts)
- [ ] Notification toasts for new submissions
- [ ] Portal preview link
- [ ] Integration with patient chart (form submissions tab)
