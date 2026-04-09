# Remaining Menus — Implementation Checklist

## Tier 1: GenericListPane Configs (API paths updated)

### Clinical
- [x] Prescriptions → `/api/fhir-resource/medications`
- [x] Labs → `/api/fhir-resource/lab-orders`
- [x] Immunizations → `/api/fhir-resource/immunizations`
- [x] Referrals → `/api/fhir-resource/referrals`
- [x] Authorizations → `/api/fhir-resource/authorizations`
- [x] Care Plans → `/api/fhir-resource/care-plans`
- [x] Education → `/api/patient-education`

### Operations
- [x] Recall → `/api/recall-campaigns`
- [x] Codes → `/api/fhir-resource/code-sets`
- [x] Inventory → `/api/fhir-resource/supplies`
- [x] Payments → `/api/fhir-resource/payments`
- [x] Claims → `/api/fhir-resource/claims`

### Reports
- [x] Dashboard → `/api/report-configs`

### System
- [x] Clinical Alerts → `/api/cds-hooks/alerts`
- [x] Consents → `/api/fhir-resource/consents`
- [x] Notifications → `/api/portal/notifications/my`
- [x] Fax → `/api/fax/messages`
- [x] Doc Scanning → `/api/fhir-resource/documents`
- [x] Kiosk → `/api/kiosk/check-ins`
- [x] Audit Log → `/api/admin/audit-log`

---

## Tier 2: EditorPanes (dedicated editors)

### P1 — Critical (Done)
- [x] User Management Editor — user list, add/edit/delete, role assign, password reset
- [x] Roles & Permissions Editor — role CRUD, permission tags, FHIR scope display
- [x] Tasks Editor — task list, status filters, priority colors, create/complete/delete

### P1 — Portal Management (Done)
- [x] Portal Settings Editor — General/Features/Navigation config with save
- [x] Document Review Pane — pending docs, accept/reject with reason
- [x] Access Request Pane — pending requests, approve/deny with reason
- [x] Form Submission Pane — pending submissions, accept/reject
- [x] Portal Forms Pane — form list, active toggle, create new
- [x] Templates Pane — template list, create/delete

### P1 — Messaging (Done)
- [x] Messaging Editor — channel messages, compose bar, reactions, threads, pins, attachments
- [x] Channel List Pane — channels/DMs with unread counts, search, create
- [x] Status bar unread count

### Already Existing (No new code needed)
- [x] Encounter Config Editor → `EncounterEditor` (.ciyex/encounter.json)
- [x] Layout Config Editor → `LayoutEditor` (.ciyex/chart-layout.json)
- [x] Menu Config Editor → `MenuEditor` (.ciyex/menu.json)
- [x] Colors Config Editor → `ColorsEditor` (.ciyex/colors.json)
- [x] Roles Config Editor → `RolesEditor` (.ciyex/roles.json)
- [x] Calendar Editor → `CalendarEditor`
- [x] Patient Chart Editor → `PatientChartEditor`
- [x] Encounter Form Editor → `EncounterFormEditor`

---

## Tier 3: Hub → Extensions (Done)
- [x] Hub replaced by VS Code Extensions sidebar (Open VSX registry)
- [x] 7 extensions published to marketplace-dev.ciyexhub.com
- [x] Extension SDK (`@ciyex/extension-sdk`) published

---

## Tier 4: Developer Portal (Future — not needed for clinical users)
- [ ] API Keys management
- [ ] App submissions
- [ ] Sandbox environments
- [ ] Team management
- [ ] Analytics dashboard
- [ ] Webhook logs

---

## Commands (F1 accessible)
- [x] `ciyex.openCalendar`
- [x] `ciyex.openPatientChart`
- [x] `ciyex.openEncounter`
- [x] `ciyex.openMessaging`
- [x] `ciyex.openPortalSettings`
- [x] `ciyex.openUserManagement`
- [x] `ciyex.openRolesPermissions`
- [x] `ciyex.openTasks`

---

## Sidebar ↔ Editor Pairing
- [x] Calendar sidebar ↔ Calendar editor
- [x] Patients sidebar ↔ Patient Chart editor
- [x] Encounters sidebar ↔ Encounter Form editor
- [x] Messaging sidebar ↔ Messaging editor
- [x] Portal Management sidebar ↔ Portal Settings editor
