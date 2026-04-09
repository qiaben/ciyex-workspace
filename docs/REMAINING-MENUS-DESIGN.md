# Remaining Menu Items — Design & Implementation Plan

> **Date:** 2026-04-09
> **Status:** DRAFT

---

## 1. Implementation Tiers

### Tier 1: GenericListPane (already working, just needs correct API paths)
These use the existing GenericListPane with config — no new code needed. Already updated with FHIR endpoints.

| Menu | View ID | API Path | Status |
|------|---------|----------|--------|
| Prescriptions | ciyex.clinical.prescriptions | /api/fhir-resource/medications | Config done |
| Labs | ciyex.clinical.labs | /api/fhir-resource/lab-orders | Config done |
| Immunizations | ciyex.clinical.immunizations | /api/fhir-resource/immunizations | Config done |
| Referrals | ciyex.clinical.referrals | /api/fhir-resource/referrals | Config done |
| Authorizations | ciyex.clinical.authorizations | /api/fhir-resource/authorizations | Config done |
| Care Plans | ciyex.clinical.careplans | /api/fhir-resource/care-plans | Config done |
| Education | ciyex.clinical.education | /api/patient-education | Config done |
| Recall | ciyex.operations.recall | /api/recall-campaigns | Config done |
| Codes | ciyex.operations.codes | /api/fhir-resource/code-sets | Config done |
| Inventory | ciyex.operations.inventory | /api/fhir-resource/supplies | Config done |
| Payments | ciyex.operations.payments | /api/fhir-resource/payments | Config done |
| Claims | ciyex.operations.claims | /api/fhir-resource/claims | Config done |
| Reports | ciyex.reports.view | /api/report-configs | Config done |
| Alerts | ciyex.system.alerts | /api/cds-hooks/alerts | Config done |
| Consents | ciyex.system.consents | /api/fhir-resource/consents | Config done |
| Notifications | ciyex.system.notifications | /api/portal/notifications/my | Config done |
| Fax | ciyex.system.fax | /api/fax/messages | Config done |
| Doc Scanning | ciyex.system.docscanning | /api/fhir-resource/documents | Config done |
| Kiosk | ciyex.system.kiosk | /api/kiosk/check-ins | Config done |
| Audit Log | ciyex.system.auditlog | /api/admin/audit-log | Config done |

### Tier 2: EditorPanes (need new editor code)
Complex screens that need dedicated editors with forms, modals, and interactions.

| Screen | Priority | Effort | Description |
|--------|----------|--------|-------------|
| **Settings: User Management** | P1 | 1 day | User list, add/edit user form, role assignment, password reset |
| **Settings: Roles & Permissions** | P1 | 1 day | Role CRUD, permission matrix, FHIR scope editor |
| **Settings: Encounter Config** | P2 | 0.5 day | Field config editor, drag-drop reorder, JSON view |
| **Settings: Layout Config** | P2 | 0.5 day | Tab manager, field config per tab |
| **Settings: Menu Config** | P2 | 0.5 day | Tree editor for sidebar menu items |
| **Settings: Calendar Colors** | P3 | 0.5 day | Color picker for appointment types |
| **Tasks** | P1 | 0.5 day | Task list with create/edit form, status filters |
| **CDS Rules** | P2 | 0.5 day | Rules editor + alert history |
| **Fax (full)** | P2 | 0.5 day | Send fax form, inbox/outbox |
| **Kiosk Config** | P3 | 0.5 day | Settings form + check-in list |

### Tier 3: Hub → Extensions (already done)
Hub/Marketplace replaced by Open VSX extension registry. No new code needed.

| Screen | Replacement | Status |
|--------|-------------|--------|
| Hub Browse | VS Code Extensions sidebar | Done |
| Hub App Detail | Open VSX registry | Done |
| Hub Installed | VS Code installed extensions | Done |
| Hub Compare | N/A (use registry) | N/A |

### Tier 4: Developer Portal (future)
Developer tools for extension vendors. Not needed for clinical users.

| Screen | Status |
|--------|--------|
| API Keys | Future |
| Submissions | Future |
| Sandboxes | Future |
| Team | Future |
| Analytics | Future |
| Webhook Logs | Future |

---

## 2. Tier 2 Implementation — Settings Editors

### 2.1 User Management Editor

```
┌─────────────────────────────────────────────────────┐
│ ⚙️ User Management                                   │
├─────────────────────────────────────────────────────┤
│ [Search users...] [Staff ▼] [+ Add User]            │
│                                                      │
│ Name            Email               Role    Actions  │
│ ─────────────────────────────────────────────────── │
│ Michael Chen    michael@example.com  Admin   ✏️ 🔑 🗑️│
│ Sarah Williams  sarah@example.com    Provider ✏️ 🔑 🗑️│
│ James Lee       james@example.com    Staff   ✏️ 🔑 🗑️│
│                                                      │
│ 1-3 of 15                           ◀ 1/5 ▶        │
└─────────────────────────────────────────────────────┘
```

API: `GET /api/admin/users`, `POST/PUT/DELETE /api/admin/users/{id}`

### 2.2 Roles & Permissions Editor

```
┌─────────────────────────────────────────────────────┐
│ ⚙️ Roles & Permissions                               │
├─────────────────────────────────────────────────────┤
│ [+ New Role]                                         │
│                                                      │
│ ADMIN (system)                              [Edit]   │
│   Permissions: patients.view, patients.create, ...   │
│   FHIR: Patient.read, Patient.write, Encounter.*    │
│                                                      │
│ PROVIDER                                    [Edit]   │
│   Permissions: patients.view, encounters.create, ... │
│   FHIR: Patient.read, Encounter.*, Observation.*    │
│                                                      │
│ STAFF                                       [Edit]   │
│   Permissions: patients.view, appointments.create    │
│   FHIR: Patient.read, Appointment.*                 │
└─────────────────────────────────────────────────────┘
```

API: `GET /api/admin/roles`, `POST/PUT/DELETE /api/admin/roles/{id}`

### 2.3 Tasks Editor

```
┌─────────────────────────────────────────────────────┐
│ 📋 Tasks                                             │
├─────────────────────────────────────────────────────┤
│ [Search] [All ▼] [High ▼] [+ New Task]              │
│                                                      │
│ 🔴 Review lab results for Martinez   Due: Apr 10    │
│    Assigned to: Dr. Chen  Status: pending            │
│                                                      │
│ 🟡 Follow up with Rogers            Due: Apr 12    │
│    Assigned to: Dr. Patel  Status: in-progress       │
│                                                      │
│ 🟢 Complete insurance verification   Due: Apr 8     │
│    Assigned to: Sarah W.  Status: completed          │
└─────────────────────────────────────────────────────┘
```

API: `GET /api/tasks`, `POST/PUT/DELETE /api/tasks/{id}`

---

## 3. Implementation Order

### Week 1 (P1 — Critical Settings)
1. User Management Editor
2. Roles & Permissions Editor
3. Tasks Editor

### Week 2 (P2 — Config Editors)
4. Encounter Config Editor
5. Layout Config Editor
6. Menu Config Editor
7. CDS Rules Editor

### Week 3 (P3 — Polish)
8. Calendar Colors Editor
9. Kiosk Config Editor
10. Fax Editor (full send/receive)
