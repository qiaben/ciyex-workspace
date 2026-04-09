# Clinical Menus — Design & Implementation

> **Date:** 2026-04-09
> **Status:** IMPLEMENTATION

---

## 1. Submenus

| Menu | Type | API | Key Features |
|------|------|-----|--------------|
| **Prescriptions** | EditorPane | `/api/prescriptions` | Table + form panel, refill, discontinue, status tabs, priority filter |
| **Labs (Orders)** | GenericListPane | `/api/lab-order/search` | Order table, status timeline |
| **Labs (Results)** | GenericListPane | `/api/lab-results` | Results table, abnormal flags, trend charts |
| **Immunizations** | EditorPane | `/api/immunizations` | Table + form panel, CVX codes, route/site |
| **Referrals** | EditorPane | `/api/referrals` | Table + form, status workflow (Draft→Sent→Acknowledged→Scheduled→Completed) |
| **Care Plans** | EditorPane | `/api/care-plans` | Card view, goals/interventions, category filter |
| **CDS Rules** | EditorPane | `/api/cds/rules` | Rules + alert history tabs, severity, toggle active |
| **Authorizations** | EditorPane | `/api/prior-auth` | Prior auth, approve/deny/appeal, units tracking |
| **Education** | GenericListPane | `/api/fhir-resource/education` | Read-only list, category icons |

---

## 2. Implementation Strategy

Currently all 7 Clinical sidebar views use **GenericListPane** with configs. This works for simple lists but complex features (prescriptions, referrals, etc.) need dedicated EditorPanes.

**Phase 1 (now):** Upgrade GenericListPane configs with better columns + add click-to-open-editor for complex items.

**Phase 2 (future):** Build full EditorPanes with forms for create/edit (like EHR UI's slide-over panels).

For Phase 1, I'll create lightweight editors that show the data table with filters and action buttons, calling the real APIs.

---

## 3. Files

```
src/vs/workbench/contrib/ciyexEhr/browser/
├── editors/
│   ├── prescriptionsEditor.ts    # Rx list + refill/discontinue
│   ├── immunizationsEditor.ts    # Vaccine list + CVX form
│   ├── referralsEditor.ts        # Referral list + status workflow
│   ├── carePlansEditor.ts        # Care plan cards + goals
│   ├── cdsEditor.ts              # CDS rules + alerts tabs
│   └── authorizationsEditor.ts   # Prior auth + approve/deny
```
