# EHR Settings Competitive Analysis

## Research Summary

Analyzed settings/configuration from: **Epic**, **Cerner/Oracle Health**, **athenahealth**, **eClinicalWorks**, **DrChrono**, **OpenEMR**, **NextGen Healthcare**

## Settings Now Registered in Ciyex Workspace (Cmd+, Settings Editor)

### 26 Categories, 120+ Settings

| # | Category | Settings | Source Vendors |
|---|----------|----------|----------------|
| 1 | **Server** | API URL, Keycloak config, environment | Core |
| 2 | **Display** | Font size, compact mode, avatars | DrChrono, OpenEMR |
| 3 | **Calendar** | View, hours, slot duration, color-by, weekends | Epic Cadence, athenahealth, OpenEMR |
| 4 | **Session** | Idle timeout, warning, auto-refresh, login required | OpenEMR, HIPAA requirement |
| 5 | **Features** | CDS Hooks, SMART, portal, telehealth, kiosk, inventory, fax | All vendors |
| 6 | **Practice** | Name, NPI, timezone, session timeout | All vendors |
| 7 | **AI** | Enabled, provider, clinical notes, coding, summary | NextGen, athenahealth |
| 8 | **Billing** | Fee schedule, auto-post, require diagnosis, POS | OpenEMR, athenahealth, eCW |
| 9 | **Prescriptions** | eRx, controlled substance, drug interaction | OpenEMR, NextGen, athenahealth |
| 10 | **Calendar Colors** | Color-by, working hours bg, non-working bg | OpenEMR, DrChrono |
| 11 | **Patient Portal** | Name, URL, language, 7 feature toggles | Epic MyChart, athenahealth, OpenEMR |
| 12 | **Roles** | Default role, patient role, MFA requirement | All vendors |
| 13 | **Clinical Workflow** | Default form, auto-save, units, advance directives, amendments, templates, age display | Epic, OpenEMR, eCW, athenahealth |
| 14 | **Notifications** | Sender, SMTP, email/SMS reminder timing, gateway, daily agenda | OpenEMR, athenahealth, DrChrono |
| 15 | **Audit & Compliance** | Audit logging, patient access, scheduling, orders, MIPS, CQM | OpenEMR, HIPAA, CMS |
| 16 | **Security** | Password policy, expiration, failed attempts, 2FA, SSO | OpenEMR, athenahealth, DrChrono |
| 17 | **E-Sign & Consent** | Encounter signing, lock-on-sign, cosign, telehealth consent, immunization consent | OpenEMR, Epic |
| 18 | **Telehealth** | Provider, waiting room, recording, duration, screen share, multi-party, auto-link | Epic, eCW, athenahealth |
| 19 | **Documents** | Storage, max size, thumbnails, encryption, scanner, fax provider | OpenEMR, PCC |
| 20 | **Insurance** | Eligibility verification, provider, multiple insurance, auto-verify | athenahealth, eCW, OpenEMR |
| 21 | **Reporting** | End-of-day reports, per-provider, dashboard | OpenEMR, athenahealth |
| 22 | **Patient Flow Board** | Enabled, refresh interval, show visit reason, show wait time | OpenEMR, Epic |
| 23 | **Print & PDF** | Paper size, orientation, font size, practice logo | OpenEMR |
| 24 | **Patient Kiosk** | Demographics, insurance capture, copay, consent, timeout | eCW, Epic |
| 25 | **Lab & Imaging** | HL7, abnormal alerts, critical alerts, immunization registry | eCW, athenahealth, OpenEMR |
| 26 | **Prescriptions Advanced** | eRx provider, EPCS, DEA/NPI display, Tall Man names, formulary | OpenEMR, NextGen, athenahealth |

## What Each Vendor Does Best

| Vendor | Strength | Settings We Adopted |
|--------|----------|---------------------|
| **OpenEMR** | Most granular admin settings (400+) | Password policy, audit trail, billing format, PDF layout, lab exchange |
| **athenahealth** | Best workflow automation | Eligibility verification, reminder channels, daily agenda, message routing |
| **Epic** | Best clinical decision support | Advance directives, encounter locking, cosign, best practice alerts |
| **eClinicalWorks** | Best telehealth integration | Auto-send link, kiosk check-in, HL7 lab interfaces |
| **DrChrono** | Best modern UX settings | Font size options, color customization, SSO, daily schedule email |
| **NextGen** | Best prescription management | EPCS, Tall Man names, formulary search, prescribing delegates |

## Gaps Remaining (Future Consideration)

These exist in competitors but are too complex for a settings toggle:

1. **Order Sets / Smart Phrases** (Epic) — Need dedicated builder, not settings
2. **Custom Flowsheets** (Epic, NextGen) — Need visual designer
3. **Clearinghouse Integration** (athenahealth) — Needs dedicated setup wizard
4. **PACS/Imaging Integration** (Cerner) — Needs connector framework
5. **Revenue Cycle Automation** (athenahealth) — Needs rule engine
6. **Population Health Analytics** (Epic, Cerner) — Needs BI module
