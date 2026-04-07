# EHR Scheduling & Calendar -- Competitive Analysis

**Prepared for:** Ciyex Workspace Calendar Module Design  
**Date:** 2026-04-06  
**Copyright:** Ciyex Inc.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Vendor-by-Vendor Analysis](#vendor-by-vendor-analysis)
   - [Epic Cadence](#1-epic-cadence)
   - [Cerner / Oracle Health](#2-cerner--oracle-health-scheduling)
   - [athenahealth](#3-athenahealth-scheduling)
   - [eClinicalWorks](#4-eclinicalworks-scheduling)
   - [DrChrono](#5-drchrono-scheduling)
   - [OpenEMR](#6-openemr-calendar)
   - [NextGen](#7-nextgen-scheduling)
   - [Kareo / Tebra](#8-kareo--tebra-scheduling)
   - [Practice Fusion](#9-practice-fusion-scheduling)
   - [ModMed](#10-modmed-modernizing-medicine)
3. [Feature Comparison Matrix](#feature-comparison-matrix)
4. [FHIR Resources Summary](#fhir-resources-summary)
5. [Key Takeaways for Ciyex Workspace](#key-takeaways-for-ciyex-workspace)

---

## Executive Summary

This document provides a comprehensive competitive analysis of scheduling and calendar features across 10 major EHR systems. The analysis covers calendar views, appointment types, booking workflows, patient self-scheduling, check-in/status tracking, reminders, provider schedule management, reporting, integrations, and FHIR resource usage.

**Key industry trends observed:**

- **Patient self-scheduling** is now table-stakes -- every major vendor offers it, with Epic MyChart leading at 35-50% self-scheduling adoption rates.
- **Automated waitlist backfill** (e.g., Epic Fast Pass) is a major differentiator, with systems reporting 18-21% improvement in slot fill rates.
- **Predictive no-show scoring** using AI/ML is emerging in enterprise systems (Epic, Oracle Health), reducing no-shows by 17-22%.
- **Multi-resource scheduling** (provider + room + equipment) is standard in enterprise systems but weak in smaller EHRs.
- **FHIR R4 Appointment/Schedule/Slot** resources are the interoperability standard, though implementation depth varies widely.
- **Drag-and-drop rescheduling** is universally expected across all tiers.
- **Color-coded calendar views** with multi-provider side-by-side display is standard.
- **Kiosk and mobile check-in** are increasingly common, with automated eligibility verification on arrival.

---

## Vendor-by-Vendor Analysis

---

### 1. Epic Cadence

**Market Position:** #1 enterprise EHR. Cadence is Epic's dedicated scheduling module, used by most large health systems in the US. Deeply integrated with MyChart (patient portal), Prelude (registration), and Resolute (billing).

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Standard daily schedule view per provider |
| Week view | Yes | Weekly grid display |
| Month view | Yes | Monthly overview |
| List view | Yes | Department Appointments Report (DAR) serves as list |
| Multi-provider view | Yes | **Snapboard** shows appointments for multiple providers in a department side-by-side |
| Multi-location view | Yes | Centralized scheduling across clinics, specialties, and facilities |
| Timeline/Gantt view | Yes | Schedule timeline with resource utilization visualization |
| Color coding | Yes | By visit type, provider, department, and appointment status |
| Mini calendar navigation | Yes | Date navigation arrows and calendar picker |
| Today button / date picker | Yes | Standard navigation controls |

**Notable:** The Snapboard is Epic's signature multi-provider view -- it provides a real-time, drag-and-drop capable overview of all providers in a department with visual slot availability.

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | Extensive library: new patient, follow-up, procedure, consult, telehealth, group, etc. |
| Duration per visit type | Yes | Configurable per visit type and provider |
| Color per visit type | Yes | Each visit type can have a distinct color |
| Required fields per type | Yes | Configurable required data elements per visit type |
| Pre-visit questionnaires | Yes | Linked via MyChart; auto-sent on scheduling |
| Telehealth vs in-person flag | Yes | Native telehealth visit types when paired with Epic's telehealth suite |
| Provider schedule templates | Yes | Recurring weekly templates with time blocks for visit types |
| Template exceptions/overrides | Yes | Edit Template for Single Day activity; Template Audit Trail Report tracks all changes |

**Notable:** Blocks can be placed on a provider's template to restrict time slots to specific visit types (e.g., new patient block at 8 AM ensures only new patient visits can be booked there). Templates are so flexible that organizations publish schedules a full year in advance. Decision trees route patients to the correct visit type, provider, and location.

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Rules-based slot search with provider, specialty, visit type, and location filters |
| Double-booking rules | Yes | Conflict resolution prevents double-bookings; configurable overbooking rules |
| Overbooking alerts | Yes | Alerts when scheduling conflicts arise |
| Walk-in handling | Yes | Supported via DAR workflow |
| Waitlist management | Yes | **Fast Pass** -- patients add themselves to waitlist; automated SMS/email notification when slot opens |
| Recurring appointments | Yes | Series of appointments for the same patient on a regular basis |
| Group appointments | Yes | Group therapy, family scheduling (back-to-back), combined visits |
| Multi-resource scheduling | Yes | **Joint appointments** -- single visit with multiple providers/resources using one visit type; resource matching for equipment and rooms |
| Drag-and-drop rescheduling | Yes | Snapboard drag-and-drop from case depot to main schedule |
| Copy/move appointments | Yes | Rescheduling workflows with audit trail |
| Appointment series | Yes | Series scheduling for recurring treatment plans |

**Notable:** Fast Pass waitlist has driven a 75,000 annual visit increase at WakeMed with 21% outpatient revenue growth. Decision trees improve first-call resolution by matching the right visit type/provider/location.

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking | Yes | Via **MyChart** portal and mobile app |
| Direct Scheduling | Yes | Existing patients with active MyChart accounts book directly with established providers |
| Open Scheduling | Yes | New and existing patients can schedule without a MyChart account |
| Buffer time | Yes | Configurable per visit type |
| New vs established patient rules | Yes | Different workflows for new patient vs returning |
| Insurance verification | Yes | Integration with Prelude registration |
| Questionnaire before booking | Yes | Pre-visit questionnaires auto-sent via MyChart |
| Provider preference | Yes | Patients can choose their provider |
| Location preference | Yes | Multi-location support |
| Real-time availability | Yes | Live slot availability display |

**Notable:** 47% of follow-up visits were self-scheduled within first 90 days at one implementation. Self-scheduling reduces call center volume by ~40% (Cleveland Clinic data).

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Scheduled, Confirmed, Arrived, Checked-In, Roomed, With Provider, Checked-Out, No-Show, Cancelled, Left Without Being Seen |
| Status workflow | Yes | Dashboard statuses track patient movement through clinic; manual or automatic updates |
| Auto-status updates | Yes | Automated transitions based on workflow events |
| Kiosk check-in | Yes | **Epic Welcome Kiosk** -- patients check in, register, update demographics directly into Epic |
| Mobile check-in | Yes | Via MyChart mobile app |
| Eligibility verification | Yes | Real-time eligibility check on check-in |
| Copay collection | Yes | Cash drawer integration for copay collection at check-in/check-out |
| Wait time tracking | Yes | "Waiting Room Time" = minutes between check-in and roomed time; kiosk shows real-time wait estimates |
| Room assignment | Yes | Patient Multi-Provider Schedule activity tracks rooming |

**Notable:** The Department Appointments Report (DAR) is the central hub for check-in/check-out workflows, providing a real-time view of all daily appointments with status indicators.

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email reminders | Yes | Configurable timing |
| SMS reminders | Yes | Text message reminders with confirmation |
| Phone/IVR reminders | Yes | Automated voice calls via IVR integration |
| Reminder timing | Yes | Configurable (e.g., 48h, 24h, 2h before) |
| Confirmation requests | Yes | Patients can confirm or cancel via text/email reply |
| No-show follow-up | Yes | Automated notifications for missed appointments |
| Cancellation notifications | Yes | Auto-notify on cancellation |
| Recall reminders | Yes | IVR-based recall reminders; recall system integration |
| Patient notification preferences | Yes | Up to 2 reminder types selectable; email, MyChart, or opt-out per notification type |
| Predictive no-show alerts | Yes | AI-based predictive no-show risk scoring prompts high-risk patients to confirm |

**Notable:** Epic recently demonstrated an AI tool for SMS appointment scheduling. Predictive no-show scoring has achieved 22% improvement in no-show rates.

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Availability blocks | Yes | Blocks restrict specific time slots to specific visit types |
| Time-off/vacation | Yes | **Held time** (reserved from scheduling) and **Unavailable time** (provider not available) |
| Weekly recurring templates | Yes | Template Builder creates weekly recurring schedules |
| Open/close schedule slots | Yes | Staff can hold templates or mark schedules unavailable |
| Block types | Yes | Visit-type-specific blocks (new patient, follow-up, procedure, etc.) |
| Lunch/break blocks | Yes | Configurable break periods |
| Override specific dates | Yes | Edit Template for Single Day activity |
| Cross-coverage | Yes | Multi-provider scheduling with shared visibility |
| Template audit trail | Yes | Template Audit Trail Report: who changed what, when |

**Notable:** The Cadence team defines sessions and releases blocks to departments, while clinic staff manage holds and unavailability -- clear separation of responsibilities.

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Utilization reports | Yes | Provider utilization rates, slot fill rates |
| No-show rates | Yes | Tracked with predictive analytics |
| Cancellation rates | Yes | Statistical reporting on cancellations |
| Wait time analytics | Yes | Waiting room time tracking and reporting |
| Provider productivity | Yes | Staff utilization projections |
| Revenue per time slot | Yes | Integration with Resolute billing; revenue impact analysis |
| Appointment type distribution | Yes | Visit type mix reporting |
| New vs returning ratio | Yes | Patient mix analytics |
| Schedule fill rate | Yes | 18% improvement reported with automated waitlist logic |
| Custom dashboards | Yes | Reporting Workbench with customizable KPI dashboards |

**Notable:** Cadence includes scheduling dashboards and custom reporting through Epic's Reporting Workbench. Key metrics: no-shows, utilization, lead time, fill rate, Third Next Available appointment.

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Auto-create encounter on check-in | Yes | Configurable auto-encounter creation |
| Auto-generate superbill | Yes | Integration with Resolute billing |
| CDS hooks on scheduling | Yes | Decision trees for preventive care routing |
| Recall system integration | Yes | IVR-based recall with documentation back to Epic |
| Referral-to-appointment | Yes | Scheduling from appointment requests; linked referrals |
| Insurance eligibility on booking | Yes | Prelude integration |
| Prior authorization check | Yes | Integrated authorization workflows |
| Google/Outlook sync | Limited | Not native; third-party integrations available |
| Waitlist auto-fill | Yes | Fast Pass automated backfill |
| HL7v2 integration | Yes | Full HL7v2 scheduling message support |
| FHIR integration | Yes | HL7v2 and FHIR-based integration with third-party systems |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Yes | Appointment.$find and $book operations; read/search/create |
| Schedule | Yes | Practitioner + Location schedule containers |
| Slot | Yes | Time-slot availability queries (Epic recommends $find over bespoke Slot queries) |
| Practitioner | Yes | Full support |
| PractitionerRole | Yes | Full support |
| Location | Yes | Full support |
| HealthcareService | Yes | Service categorization |
| Patient | Yes | Full support |

---

### 2. Cerner / Oracle Health Scheduling

**Market Position:** #2 enterprise EHR (acquired by Oracle in 2022). Scheduling Management module coordinates appointment scheduling across integrated or disparate health systems. Now branded as Oracle Health.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Appointment Book daily view |
| Week view | Yes | Weekly scheduling grid |
| Month view | Yes | Monthly overview |
| List view | Yes | Tabular appointment list |
| Multi-provider view | Yes | Multiple resource schedules in Appointment Book |
| Multi-location view | Yes | Cross-facility scheduling support |
| Timeline view | Yes | Expandable/collapsible Appointment Book display |
| Color coding | Yes | By appointment type, resource, and status |
| Mini calendar | Yes | Calendar widget displays schedule dates |
| Today button / date picker | Yes | Date navigation in Appointment Book |

**Notable:** The Appointment Book is the central scheduling interface; users can expand or decrease the display view and navigate between resources and dates.

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | Appointment types with scheduling location, requesting physician, and details |
| Duration per visit type | Yes | Configurable per appointment type |
| Color per visit type | Yes | Color-coded by type |
| Required fields per type | Yes | Appointment type drives required data |
| Pre-visit questionnaires | Yes | Patient portal integration |
| Telehealth flag | Yes | Virtual visit appointment types |
| Provider schedule templates | Yes | Resource availability templates with defined time periods |
| Template exceptions | Yes | Override scheduling for specific dates |
| Recurring appointments | Yes | Daily frequency, hours-between settings for recurring appointments |

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Slot search with resource, type, and date filters |
| Double-booking rules | Yes | Configurable conflict detection |
| Overbooking alerts | Yes | Alert on scheduling conflicts |
| Walk-in handling | Yes | Supported through scheduling workflow |
| Waitlist management | Yes | Via integrated partners (e.g., Relatient Dash) |
| Recurring appointments | Yes | Recurring appointment configuration with daily frequency and hours-between |
| Group appointments | Yes | Multi-patient scheduling |
| Multi-resource scheduling | Yes | Multiple resources per appointment slot |
| Drag-and-drop | Yes | Appointment movement in book |
| Copy/move | Yes | Reschedule and copy workflows |
| Appointment series | Yes | Recurring series with defined intervals |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking | Yes | Oracle Health Patient Administration self-service; 24/7 real-time availability |
| Visit type filtering | Yes | Configurable visit types for online booking |
| New vs established rules | Yes | Patient type routing |
| Insurance verification | Yes | Pre-visit eligibility check |
| Questionnaire before booking | Yes | Pre-registration completion |
| Provider preference | Yes | Patient can select provider |
| Location preference | Yes | Multi-location support |
| Real-time availability | Yes | Live slot display |

**Notable:** Oracle Health has invested in AI/ML technology for patient administration to reduce manual scheduling processes.

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Scheduled, Confirmed, Arrived, In Progress, Completed, Cancelled, No-Show |
| Status workflow | Yes | Guided workflow automation |
| Auto-status updates | Yes | AI-assisted status transitions |
| Kiosk check-in | Yes | Digital check-in at facility |
| Mobile check-in | Yes | Patient app check-in |
| Eligibility verification | Yes | Automated on check-in |
| Copay collection | Yes | Integrated payment processing |
| Wait time tracking | Yes | Patient tracking through visit |
| Room assignment | Yes | Resource/room tracking |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email/SMS/Phone reminders | Yes | Multi-channel reminder delivery |
| Reminder timing | Yes | Configurable intervals |
| Confirmation requests | Yes | Patient confirmation workflows |
| No-show follow-up | Yes | Automated outreach |
| Cancellation notifications | Yes | Auto-notify on cancellation |
| Recall reminders | Yes | Follow-up scheduling reminders |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Availability blocks | Yes | Defined availability periods (planning horizon) |
| Time-off management | Yes | Schedule unavailability |
| Weekly templates | Yes | Recurring schedule patterns |
| Block types | Yes | Multiple block categories |
| Override dates | Yes | Date-specific overrides |
| Provider rules | Yes | Robust provider preferences and scheduling rules |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Utilization reports | Yes | Via Lights On Network enterprise analytics |
| No-show/cancellation rates | Yes | Standard metrics |
| Wait time analytics | Yes | Patient flow analytics |
| Provider productivity | Yes | Resource utilization |
| Custom dashboards | Yes | Enterprise-level data analytics |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Auto-create encounter | Yes | Encounter creation on check-in |
| Referral-to-appointment | Yes | Integrated referral workflows |
| Insurance eligibility | Yes | Automated verification |
| HL7v2 integration | Yes | Full HL7v2 support |
| FHIR integration | Yes | R4 APIs (deprecated DSTU-2 by Dec 2025) |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Yes | R4 search by date, participant, service category; create/read/update |
| Schedule | Yes | Planning horizon with actor (single service/resource); read by ID |
| Slot | Yes | Date range search; status (free/busy/busy-unavailable) |
| Practitioner | Yes | Full support |
| PractitionerRole | Yes | Full support |
| Location | Yes | Full support |
| HealthcareService | Yes | Via serviceType (SNOMED CT and proprietary code sets) |
| Patient | Yes | Full support |

**Notable:** Oracle Health committed to deprecating DSTU-2 by December 2025; all new integrations should target FHIR R4 exclusively.

---

### 3. athenahealth Scheduling

**Market Position:** Leading cloud-based EHR for ambulatory practices. Known for strong network effects and rules-based revenue cycle management. athenaOne is the unified platform.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Daily provider schedule |
| Week view | Yes | Weekly grid |
| Month view | Yes | Monthly overview |
| List view | Yes | Appointment list |
| Multi-provider view | Yes | Side-by-side provider calendars |
| Multi-location view | Yes | Multi-facility scheduling |
| Color coding | Yes | By provider, appointment type, status |
| Mini calendar | Yes | Date navigation widget |
| Today/date picker | Yes | Standard controls |

**Notable:** Third-party integrations (e.g., DayBack Calendar) extend athenahealth with more advanced visual scheduling including Gantt-style views.

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | New patient, established, procedure, telehealth, etc. |
| Duration per visit type | Yes | Configurable with buffers |
| Color per visit type | Yes | Color-coded types |
| Required fields per type | Yes | Configurable per visit type |
| Pre-visit questionnaires | Yes | Auto-sent on scheduling |
| Telehealth flag | Yes | Telehealth appointment types |
| Provider schedule templates | Yes | Working hours, breaks, blockouts |
| Template exceptions | Yes | Override for specific dates |

**Notable:** Practices can set duration, buffers, and booking windows per visit type, and exclude complex/high-risk visit types from online scheduling.

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Provider-filtered slot search |
| Double-booking rules | Yes | Configurable conflict rules |
| Overbooking alerts | Yes | Alert on overbook |
| Walk-in handling | Yes | Add walk-in to schedule |
| Waitlist management | Partial | No native automated waitlist; relies on third-party integrations (e.g., Emitrr, Luma) |
| Recurring appointments | Yes | Recurring scheduling |
| Group appointments | Limited | Basic group scheduling |
| Multi-resource scheduling | Limited | Provider + location; limited room/equipment |
| Drag-and-drop | Yes | Reschedule via drag-and-drop |
| Appointment series | Yes | Series of recurring visits |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking | Yes | athenahealth Patient Portal (web) and athenaPatient mobile app |
| Visit type filtering | Yes | Practice controls which visit types are bookable online |
| Buffer time | Yes | Configurable between appointments |
| New vs established rules | Yes | Different flows |
| Insurance verification | Yes | Automated eligibility verification |
| Questionnaire before booking | Yes | Pre-visit forms |
| Provider preference | Yes | Patient selects provider |
| Location preference | Yes | Multi-location |
| Real-time availability | Yes | Live calendar sync |

**Notable:** Third-party partners (Medfusion, InQuicker) extend self-scheduling capabilities through the athenahealth marketplace.

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Scheduled, Confirmed, Arrived, Checked-In, Exam Room, With Provider, Checked-Out, No-Show, Cancelled |
| Status workflow | Yes | Configurable status transitions |
| Auto-status updates | Yes | Workflow-driven |
| Digital check-in | Yes | Pre-visit registration, demographics, insurance updates |
| Mobile check-in | Yes | Via athenaPatient app |
| Eligibility verification | Yes | Automated on check-in |
| Copay collection | Yes | Payment collection at check-in |
| Wait time tracking | Yes | Real-time dashboards |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email/SMS/Phone reminders | Yes | All three channels, customizable per patient preference |
| Reminder timing | Yes | Configurable intervals |
| Confirmation requests | Yes | Patient reply to confirm |
| No-show follow-up | Yes | Automated outreach |
| Recall reminders | Yes | Follow-up scheduling |
| Campaign messaging | Yes | Patient communication campaigns |

**Notable:** Clinics using athenahealth automated reminders see approximately 30% decrease in no-show rates.

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Availability blocks | Yes | Working hours, break blocks |
| Time-off management | Yes | Vacation/time-off blocking |
| Weekly templates | Yes | Recurring schedule patterns |
| Block types | Yes | Office, break, admin blocks |
| Override dates | Yes | Date-specific changes |
| Blockouts | Yes | Provider-specific blockouts |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Utilization reports | Yes | Appointment utilization tracking |
| No-show rates | Yes | Real-time no-show dashboards |
| Cancellation rates | Yes | Tracked and reported |
| Wait time analytics | Yes | Real-time dashboards |
| Provider productivity | Yes | Volume and productivity metrics |
| Appointment trends | Yes | Trend analysis over time |
| Patient demographics | Yes | Demographic reporting |
| Booked appointment reports | Yes | API-accessible appointment reports |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Auto-create encounter | Yes | Encounter on check-in |
| Auto-generate superbill | Yes | Billing integration |
| Insurance eligibility | Yes | Automated eligibility checking |
| Referral tracking | Yes | Referral-to-appointment workflows |
| Pre-visit automation | Yes | Automated refill, payment, and pre-visit workflows |
| Webhook/API events | Yes | OAuth2 RESTful API with webhooks |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Yes | Read, search, create, update; custom search parameters include Schedule for filling Slots |
| Schedule | Yes | Referenced from Appointment/Slot |
| Slot | Yes | Search by date, provider; availability queries |
| Practitioner | Yes | Full support |
| PractitionerRole | Yes | Full support |
| Location | Yes | Full support |
| Patient | Yes | Full support |

**Notable:** athenahealth provides both a proprietary REST API and FHIR R4 API. The proprietary API has richer scheduling endpoints including appointment reminders and booked appointment reports.

---

### 4. eClinicalWorks Scheduling

**Market Position:** Major ambulatory EHR serving 150,000+ physicians. Known for value pricing and healow patient engagement platform.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Resource Schedule daily view |
| Week view | Yes | Weekly grid |
| Month view | Yes | Monthly overview |
| List view | Yes | Appointment list view |
| Multi-provider view | Yes | Multiple provider calendars viewable simultaneously |
| Multi-location view | Yes | Room schedules and resource allocation |
| Color coding | Yes | By appointment status and type |
| Mini calendar | Yes | Calendar-based navigation |
| Today/date picker | Yes | Standard controls |

**Notable:** The Resource Schedule is the primary scheduling interface, showing provider availability, room schedules, and resource allocation in one view.

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | Configurable appointment categories |
| Duration per visit type | Yes | Customizable durations |
| Color per visit type | Yes | Color-coded categories |
| Required fields per type | Yes | Configurable |
| Pre-visit questionnaires | Yes | Via healow CHECK-IN |
| Telehealth flag | Yes | Virtual visit types |
| Provider schedule templates | Yes | Customizable templates per provider/specialty |
| Template exceptions | Yes | Date-specific overrides |

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Slot search by provider, date, type |
| Double-booking rules | Yes | Double-click on time slot to create; conflict detection |
| Overbooking alerts | Yes | Visual alert on conflicts |
| Walk-in handling | Yes | Add to schedule |
| Waitlist management | Yes | Via third-party integration (e.g., Luma); configurable criteria for waitlist offers |
| Recurring appointments | Yes | Series scheduling |
| Group appointments | Limited | Basic group support |
| Multi-resource scheduling | Yes | Room and provider coordination |
| Drag-and-drop | Yes | Reschedule via drag-and-drop |
| Referral linking | Yes | Link referrals to appointments for billing and reporting |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking | Yes | **healow Open Access** -- patients book via website, Patient Portal, or healow app |
| Visit type filtering | Yes | Practice controls available types |
| New vs established rules | Yes | Patient routing |
| Insurance verification | Yes | Via healow CHECK-IN |
| Questionnaire before booking | Yes | Pre-visit questionnaires via healow CHECK-IN |
| Provider preference | Yes | Patient selects provider |
| Location preference | Yes | Multi-location |
| Real-time availability | Yes | Providers' real-time schedules displayed |

**Notable:** One new practice filled 400 appointment slots through healow self-scheduling, demonstrating strong patient adoption.

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Pending, Confirmed, Arrived, Checked-In, In Exam, With Provider, Checked-Out, Cancelled, No-Show |
| Status workflow | Yes | Visit Status Drop-Down tracks appointment status transitions |
| Contactless check-in | Yes | **healow CHECK-IN** -- manages reminders, check-in, questionnaires, insurance checks, copayments |
| Eligibility verification | Yes | Insurance check during check-in |
| Copay collection | Yes | Payment collection from appointment screen |
| Wait time tracking | Yes | Patient flow monitoring |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email/SMS/Phone reminders | Yes | Automated via text, email, or phone |
| Reminder timing | Yes | Configurable intervals |
| Confirmation requests | Yes | Patient confirmation |
| No-show follow-up | Yes | Automated outreach |
| Recall reminders | Yes | Follow-up scheduling |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Availability blocks | Yes | Provider availability configuration |
| Time-off management | Yes | Block unavailable time |
| Weekly templates | Yes | Recurring schedule templates |
| Block types | Yes | Multiple block categories |
| Override dates | Yes | Date-specific changes |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Utilization reports | Yes | Customizable reports on clinical, financial, operational metrics |
| No-show rates | Yes | Tracked |
| Cancellation tracking | Yes | View cancelled appointments |
| Provider productivity | Yes | Practice performance insights |
| Custom reports | Yes | Detailed actionable reporting |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Auto-create encounter | Yes | Encounter on check-in |
| Billing integration | Yes | Billing and revenue cycle management |
| HL7v2 integration | Yes | Near-real-time HL7v2 message triggers |
| FHIR integration | Yes | healow FHIR Developer Portal; FHIR enriches HL7v2 event triggers |
| ePrescribing | Yes | Integrated |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Yes | Via healow FHIR Developer Portal |
| Schedule | Yes | Provider schedule data |
| Slot | Yes | Availability data |
| Practitioner | Yes | Provider data |
| Location | Yes | Facility data |
| Patient | Yes | Patient data |

**Notable:** eClinicalWorks uses a "twin strategy" -- HL7v2 for real-time event triggers (appointment created/changed) and FHIR for on-demand enrichment and context.

---

### 5. DrChrono Scheduling

**Market Position:** Cloud-based, iPad-first EHR targeting small-to-mid practices. Strong API and developer ecosystem. Now part of EverHealth.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Daily schedule |
| Week view | Yes | Weekly grid |
| Month view | Yes | Monthly overview |
| Multi-provider view | Yes | Multiple provider calendars |
| Multi-location view | Yes | Multi-office support |
| Color coding | Yes | Color-coded by appointment profile/type |
| Mini calendar | Yes | Date navigation |
| Today/date picker | Yes | Standard controls |

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | **Appointment Profiles** -- pre-set billing codes, forms, duration, color, and billing profile per type |
| Duration per visit type | Yes | Realistic time blocks set by appointment type |
| Color per visit type | Yes | Color-coding per appointment profile |
| Required fields per type | Yes | Consent forms auto-attached per type |
| Pre-visit questionnaires | Yes | Forms pre-populated for specific appointment types |
| Telehealth flag | Yes | Telehealth appointment booking via scheduling widget |
| Provider schedule templates | Yes | Provider availability configuration |
| Exam room limits | Yes | Default: one appointment per exam room; configurable for multiple |

**Notable:** Appointment Profiles are DrChrono's differentiator -- they bundle duration, reason for visit, consent forms, color-coding, and billing profile into a single configuration per visit type.

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Slot search by provider and date |
| Double-booking rules | Yes | Configurable per exam room (default: one appointment per room) |
| Walk-in handling | Yes | Add to schedule |
| Recurring appointments | Yes | Series scheduling |
| Drag-and-drop | Yes | Reschedule support |
| API-based scheduling | Yes | Full REST API for create/modify/retrieve/delete appointments |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking widget | Yes | Embeddable scheduling widget for practice websites; open API for custom integration |
| Cutoff time | Yes | Configurable minimum notice for appointment requests |
| Auto-confirmation emails | Yes | Automatic confirmation on booking |
| Telehealth booking | Yes | Virtual visit scheduling via widget |
| Real-time availability | Yes | Live calendar sync with conflict prevention |

**Notable:** The scheduling widget can be coded into any external website via open API, or a direct link can be placed on the practice website.

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Scheduled, Confirmed, Arrived, In Room, With Provider, Complete, No-Show, Cancelled |
| Kiosk check-in | Yes | **iPad Kiosk** -- patients self check-in, complete consent forms, update demographics; auto-populated by appointment type |
| Consent form signing | Yes | On-device signature capture |
| Auto-populated forms | Yes | Forms pre-loaded based on appointment profile |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email reminders | Yes | Automated |
| SMS reminders | Yes | Text message reminders |
| Phone reminders | Yes | Automated phone calls |
| No-show reduction | Yes | Automated outreach tools |
| Recall campaigns | Yes | Recall and reactivation campaigns |
| Patient satisfaction surveys | Yes | Post-visit surveys |
| Two-way messaging | Yes | Patient-provider messaging |
| Communication analytics | Yes | Usage tracking for faxes, SMS, phone reminders, video visits |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Availability blocks | Yes | Provider scheduling configuration |
| Time-off management | Yes | Block unavailable time |
| Office hours | Yes | Working hours setup |
| Break blocks | Yes | Lunch/break configuration |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Billing analytics | Yes | Collections optimization and denial reduction |
| Usage analytics | Yes | Fax, SMS, phone, video visit usage counts |
| Practice management reports | Yes | Standard PM reporting |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Open API | Yes | Full REST API (v4) for appointment CRUD operations |
| FHIR R4 | Yes | FHIR API via OnPatient portal connection |
| Webhook support | Yes | Event-driven integrations |
| Billing integration | Yes | Integrated PM and billing |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Yes | Via FHIR R4 API through OnPatient/ConnectEHR |
| Practitioner | Yes | Provider data |
| Patient | Yes | Lightweight patient endpoint for scheduling (non-clinical) |
| Location | Yes | Practice/facility data |

**Notable:** DrChrono offers both a proprietary REST API (richer scheduling operations) and FHIR R4 API (standards-based access). The lightweight patient endpoint is specifically designed for scheduling use cases.

---

### 6. OpenEMR Calendar

**Market Position:** Leading open-source EHR. Free and community-driven. Used globally, especially in resource-limited settings. Highly customizable but requires technical setup.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Daily provider schedule |
| Week view | Yes | Weekly grid |
| Month view | Yes | Monthly overview |
| Multi-provider view | Yes | Configurable: "Providers See Entire Calendar" setting |
| Multi-location view | Yes | Multi-facility support |
| Color coding | Yes | By appointment category/status |
| Date navigation | Yes | Arrow navigation at top of screen |
| Patient search | Yes | Search by name from calendar |

**Notable:** Calendar starting/ending hours, interval (minimum appointment duration), and other settings are configured via Admin > Config > Calendar tab. The calendar is the central tool for appointment management and feeds data to billing and reporting.

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | **Calendar Categories**: New Patient, Established Patient, custom categories |
| Telehealth types | Yes | Telehealth module adds "Telehealth Established Patient" and "Telehealth New Patient" categories |
| Custom categories | Yes | Custom categories for different treatment sessions; alphabetized in dropdown |
| Duration per type | Yes | Configurable; Calendar Interval sets minimum duration |
| Provider schedule templates | Yes | **In Office** and **Out of Office** time blocks; repeating events |
| Recurring events | Yes | Set up an event once for a given period (recurring) |

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Partial | 7-day availability display; no advanced multi-criteria search |
| Double-booking rules | Limited | Basic conflict detection |
| Walk-in handling | Yes | Add to schedule |
| Recurring appointments | Yes | Repeating event creation |
| Patient search on booking | Yes | Search by name, partial name |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Patient portal booking | Partial | Patient portal appointment requests (requires calendar configuration) |
| Real-time availability | Limited | Basic availability display |

**Notable:** Patient portal self-scheduling will not function until the calendar is properly configured with provider In Office events.

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Multiple statuses with unique symbols; configurable status list |
| Status updates | Yes | Double-click appointment to change status via dropdown |
| Room assignment | Partial | Room number customization available |
| Flow Board | Yes | Patient tracking through visit (configurable) |
| Comments/hover | Yes | Comments appear on hover over appointment blocks |
| Auto-encounter creation | Yes | Configurable auto-create encounter on check-in |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email reminders | Yes | Configurable via Administration > Practice > Rules |
| Clinical reminders | Yes | Rules-based clinical reminder system |
| SMS reminders | Limited | Requires third-party integration or custom development |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| In Office blocks | Yes | Special "In Office" event category |
| Out of Office blocks | Yes | Special "Out of Office" event category |
| Lunch/break blocks | Yes | "Lunch" event category |
| Recurring schedules | Yes | Repeating event patterns |
| Calendar interval | Yes | Configurable minimum appointment granularity |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Basic appointment reports | Yes | Calendar feeds data to Billing Manager and reports |
| Billing integration | Yes | Appointment/encounter data flows to practice management |
| Custom reporting | Limited | Through SQL queries or community modules |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Auto-create encounter | Yes | Configurable on check-in |
| Billing Manager feed | Yes | Calendar data flows to billing |
| HL7 integration | Yes | HL7 interface support |
| FHIR R4 API | Partial | Appointment resource supported (read-only); Schedule/Slot not fully implemented |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Partial | Read-only for specific patient; returns internal events (known issue #7141) |
| Schedule | Not implemented | Not yet available as FHIR endpoint |
| Slot | Not implemented | Provider availability not exposed via FHIR Slot |
| Practitioner | Yes | Full support |
| Location | Yes | Full support |
| Patient | Yes | Full support |

**Notable:** OpenEMR's FHIR implementation is compliant with US Core 8.0 and SMART on FHIR v2.2.0, but scheduling-specific resources (Schedule, Slot) are not yet fully implemented. This is a known gap.

---

### 7. NextGen Scheduling

**Market Position:** Major EHR for specialty practices (26 built-in specialty templates). NextGen Enterprise PM handles scheduling; NextGen Office is the cloud offering.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Daily appointment book |
| Week view | Yes | Weekly grid |
| Month view | Yes | Monthly overview |
| List view | Yes | Tabular appointment list |
| Multi-provider view | Yes | Templates for viewing multiple resources on one screen |
| Multi-location view | Yes | Enterprise-wide scheduling |
| Color coding | Yes | **Customizable color-coded scheduling templates** |
| Adjustable time increments | Yes | Configurable slot sizes |
| Today/date picker | Yes | Standard navigation |

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | Event categories with location assignments |
| Duration per visit type | Yes | Adjustable time increments |
| Color per visit type | Yes | Color-coded per event category |
| Provider schedule templates | Yes | **Weekly and daily templates** define event categories and locations for time blocks |
| Template exceptions | Yes | Override for specific days/resources |
| Pre-built specialty content | Yes | 26 specialty-specific template sets |
| Prevention of conflicts | Yes | Templates prevent scheduling in unavailable time (e.g., Wednesday afternoon off) |

**Notable:** Templates are the foundation of NextGen's appointment book. Weekly templates define the base schedule; daily templates override for specific dates. Staff meetings, recurring blocks, and other patterns are built directly into templates.

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Rules-based appointment search |
| Double-booking rules | Yes | Conflict detection and prevention |
| Overbooking alerts | Yes | Configurable alerts |
| Walk-in handling | Yes | Add to schedule |
| Waitlist management | Yes | **Smart Waitlist** via Luma integration -- auto-notifies patients when earlier slots open |
| Recurring appointments | Yes | Series scheduling |
| Group appointments | Yes | Patient group scheduling |
| Multi-resource scheduling | Yes | Multiple resources per appointment |
| Drag-and-drop | Yes | Drag-and-drop scheduling for providers and patients |
| Move multiple appointments | Yes | Bulk move capability |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking | Yes | **NextGen Self-Scheduling powered by Luma** |
| Rules-based routing | Yes | Guides patients to right appointment with right provider |
| PM/EHR integration | Yes | Integrates directly with NextGen Enterprise PM appointment book |
| Provider preference | Yes | Patient selects provider |
| Automated eligibility | Yes | Via Remote Transaction Server (RTS) |
| Real-time scheduling | Yes | Available during telehealth visits too |

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Full status workflow from scheduling through checkout |
| Eligibility verification | Yes | Automated eligibility via RTS before service delivery |
| Patient demographic tracking | Yes | Registration integration |
| Authorization management | Yes | Payer plan and coverage tracking |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email/SMS/Voice reminders | Yes | Via NextGen Patient Engage (powered by Luma) |
| Confirmation/cancel/reschedule | Yes | Patients can respond to reminders |
| Automated outreach | Yes | Integrated with schedule |
| Patient preference | Yes | Communication channel preference |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Availability blocks | Yes | Event category blocks per time slot |
| Time-off management | Yes | Unavailable time in templates |
| Weekly/daily templates | Yes | Base weekly + daily override pattern |
| Block types | Yes | Office, admin, personal, break blocks |
| Location assignment per block | Yes | Different locations per time block |
| Resource management | Yes | Multi-resource per appointment |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Utilization analytics | Yes | Operational analytics for appointment optimization |
| Booking pattern analysis | Yes | Identify underbooked days/times |
| Proactive scheduling | Yes | Data-driven proactive booking recommendations |
| Specialty-specific reports | Yes | 26-specialty reporting |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| EHR integration | Yes | Seamless PM/EHR data flow |
| Billing integration | Yes | Scheduling to billing workflow |
| Telehealth integration | Yes | Real-time scheduling during telehealth |
| FHIR R4 API | Yes | NextGen Office FHIR R4 implementation |
| Developer program | Yes | API access with code samples and documentation |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Yes | Via NextGen Office FHIR R4 API |
| Practitioner | Yes | Provider data |
| Patient | Yes | Patient data (US Core) |
| Location | Yes | Facility data |

**Notable:** NextGen offers both FHIR-based patient access APIs and Bulk FHIR API for group data export. The Developer Program provides API access, code samples, and community resources.

---

### 8. Kareo / Tebra Scheduling

**Market Position:** Cloud-based PM and EHR targeting independent practices. Kareo rebranded to Tebra in 2022, combining Kareo (PM/billing) with PatientPop (patient experience).

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Daily appointment scheduler |
| Week view | Yes | Weekly grid |
| Month view | Yes | Monthly overview |
| Provider-specific view | Yes | Filtered by provider |
| Location-filtered view | Yes | Filter by practice location |
| Color coding | Yes | **Timeblocks** color-coded by type (e.g., New Patient Visits, Do Not Schedule); appointment types and providers color-coded |
| Drag-and-drop | Yes | Effortless rescheduling |
| Mini calendar | Yes | Mobile-optimized calendar navigation |

**Notable:** Timeblocks are the building blocks of Tebra scheduling -- named blocks (e.g., "New Patient Visits", "Follow-Up", "Do Not Schedule") with assigned colors that appear on the Appointment Scheduler.

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | Configurable by visit reason |
| Duration per visit type | Yes | Customizable appointment durations based on visit reasons |
| Color per visit type | Yes | Timeblock color coding |
| Intake forms per type | Yes | Up to 10 intake or consent forms attachable per appointment |
| Telehealth flag | Yes | In-office or telehealth option (for Engage/Telehealth subscribers) |
| Provider schedule templates | Yes | Structured templates for consistency |
| Office hours configuration | Yes | Set hours per day of week per location |

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Provider/date/type search |
| Walk-in handling | Yes | Add to schedule |
| Recurring appointments | Yes | Series scheduling |
| Drag-and-drop | Yes | Reschedule and move |
| Appointment approval workflow | Yes | Staff must confirm/deny online appointment requests |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking | Yes | Unique URL for website, emails, SMS; 24/7 booking |
| Visit type filtering | Yes | Practice controls available types |
| Telehealth option | Yes | In-office or telehealth selection |
| Minimum notice time | Yes | Configurable cutoff between current time and appointment |
| Time interval setting | Yes | Configurable interval between appointments |
| Intake forms | Yes | Electronic forms sent before visit |
| Auto chart creation | Yes | Automatically creates patient chart |
| Progress bar | Yes | Guided booking flow with progress indicator |
| Google profile integration | Yes | Booking link on Google and other online profiles |
| HIPAA compliant | Yes | Secure patient data handling |
| Toggle on/off | Yes | Disable at practice or provider level |

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Scheduled, In Office, Finished -- main dashboard categories |
| Eligibility checks | Yes | Within same workflow interface |
| Payment processing | Yes | Integrated with status tracking |
| Intake form completion | Yes | Pre-visit preparation tracking |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| SMS/Email reminders | Yes | Automated appointment confirmations and reminders |
| No-show reduction | Yes | Reminder-driven |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Availability blocks | Yes | Timeblock-based scheduling |
| Office hours | Yes | Per day of week per location |
| Do Not Schedule blocks | Yes | Named block type |
| Break blocks | Yes | Configurable |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Practice performance | Yes | Operational metrics |
| Patient records | Yes | EHR-integrated reporting |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Google Calendar sync | Yes | Via third-party (Keragon/Calendly/Acuity Scheduling connectors) |
| EHR-PM sync | Yes | Kareo Platform and Desktop sync |
| HIPAA compliance | Yes | Secure data exchange |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Limited | Via third-party integration platforms |
| Patient | Limited | Basic patient data exchange |

**Notable:** Tebra's FHIR support is more limited than enterprise EHRs; most integrations happen through proprietary APIs and third-party connectors (e.g., Keragon for HIPAA-compliant workflow automation).

---

### 9. Practice Fusion Scheduling

**Market Position:** Cloud-based, free-tier EHR (ad-supported model, now Veradigm/Allscripts). Targets small independent practices. Simple and easy to use.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Daily schedule with print option |
| Week view | Yes | Weekly grid |
| Multi-provider view | Yes | Multiple provider schedules side-by-side |
| Multi-facility view | Yes | **Multi-facility scheduling** support |
| Color coding | Yes | By appointment type or provider |
| Drag-and-drop | Yes | Move/reschedule appointments from calendar view |
| Mini calendar | Yes | Date navigation |

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | Customizable event types |
| Duration per visit type | Yes | Appointment templates for common visit types (physicals, follow-ups) |
| Blocked time | Yes | Blocked time slots on calendar |
| Custom templates | Yes | Create, edit, and share templates with practice members |
| Template library | Yes | Physician-reviewed templates for common diagnoses |
| Recurring appointments | Yes | Recurring appointment management for chronic conditions |

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Search for available slots | Yes | Multi-provider availability search |
| Walk-in handling | Yes | Add to schedule |
| Recurring appointments | Yes | Series for chronic conditions |
| Drag-and-drop | Yes | Move and reschedule |

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Patient portal booking | Yes | **Patient Fusion** online appointment booking page |
| Real-time availability | Yes | Simplified scheduling from portal (2025 update) |
| Online intake forms | Yes | Auto-sent on scheduling; flow directly into chart note |

**Notable:** 2025 update introduced simplified appointment scheduling directly from the patient portal with real-time availability.

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Configurable status tracking |
| Online check-in | Yes | **Free Online Check-In** -- intake forms auto-flow to patient chart note |
| Demographic reconciliation | Yes | Demographics and insurance auto-reconciled as EHR task |
| Customizable intake forms | Yes | 100% customizable for practice |
| Eligibility verification | Yes | Automated eligibility verification on scheduling |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| Email/Phone/Text reminders | Yes | Automated appointment reminders via all channels |
| Custom message templates | Yes | Reusable templates for confirmations, lab results, etc. |
| Medication/vaccination reminders | Yes | Automated adherence reminders (2025 update) |
| Scheduled reports | Yes | Auto-generated reports sent to inbox at intervals |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Blocked time | Yes | Block time on calendar |
| Multi-facility | Yes | Manage schedules across facilities |
| Template sharing | Yes | Share schedule templates across providers |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| Advanced analytics dashboard | Yes | Patient trends and practice performance insights |
| Scheduled reports | Yes | Auto-generated on daily/weekly intervals |
| Data-driven decisions | Yes | Pattern identification for patient care optimization |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| Auto-populate chart | Yes | Intake forms flow directly into encounter note |
| Eligibility verification | Yes | Automated on scheduling |
| Patient portal | Yes | Cloud-based portal for scheduling, PHR, messaging |
| ePrescribing | Yes | Integrated |
| Lab integration | Yes | Results management |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Patient | Yes | Patient data access |
| Practitioner | Yes | Provider data |
| Appointment | Limited | Basic appointment data |

**Notable:** Practice Fusion's strength is simplicity. It lacks the deep scheduling configurability of enterprise systems but offers a clean, easy-to-learn interface suitable for small practices.

---

### 10. ModMed (Modernizing Medicine)

**Market Position:** Specialty-focused EHR (dermatology, ophthalmology, orthopedics, gastroenterology, pain management, ENT, urology, plastic surgery). EMA (Electronic Medical Assistant) is the clinical module; PM is the practice management module.

#### A. Calendar Views & Navigation

| Feature | Support | Details |
|---------|---------|---------|
| Day view | Yes | Daily schedule with appointment flow view |
| Week view | Yes | Weekly grid |
| Multi-provider view | Yes | View multiple locations and schedules |
| Multi-location view | Yes | Cross-location visibility |
| Color coding | Yes | By appointment type and status |
| Drag-and-drop | Yes | **Drag-and-drop scheduling** for rescheduling |
| Sequential patient view | Yes | Patients in order with appointment type, provider, and financial responsibility |

**Notable:** The appointment flow view shows alerts for information needing review at check-in and check-out -- integrating scheduling with clinical workflow.

#### B. Appointment Types & Templates

| Feature | Support | Details |
|---------|---------|---------|
| Visit type definitions | Yes | Specialty-specific appointment types |
| Duration per visit type | Yes | Configurable |
| Specialty optimization | Yes | Pre-built for 8+ specialties |
| Provider schedule templates | Yes | Provider availability configuration |

#### C. Booking & Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Appointment Finder | Yes | **Appointment Finder** -- pre-populated with clinical note data (provider name, service location); searches available slots |
| Double-booking detection | Yes | Automatic conflict alerts when confirming appointments |
| Waitlist management | Yes | Automated waitlist to minimize schedule gaps |
| Walk-in handling | Yes | Add to schedule |
| Drag-and-drop | Yes | Rescheduling via drag-and-drop |
| Follow-up reminders | Yes | Staff can create reminders (text, email, phone) for follow-up scheduling |

**Notable:** The Appointment Finder is a distinctive feature -- when a provider recommends a follow-up during a clinical encounter, the tool is pre-populated with context from the note (provider, location, procedure needed), making scheduling seamless.

#### D. Patient Self-Scheduling

| Feature | Support | Details |
|---------|---------|---------|
| Online booking | Yes | **Patient Self-Scheduling** via Patient Portal and from recall messages |
| Request or reschedule | Yes | Patients can request new appointments or reschedule existing ones |
| 24/7 availability | Yes | Works whether office is open or closed |
| Recall-triggered scheduling | Yes | Patients schedule from recall notification messages |
| Communication preferences | Yes | Text or email confirmation based on patient preference |

**Notable:** Self-scheduling is included in the Premium+ Solution tier and integrates directly with the practice management system.

#### E. Check-In & Status Tracking

| Feature | Support | Details |
|---------|---------|---------|
| Appointment statuses | Yes | Full status tracking through visit lifecycle |
| Kiosk check-in | Yes | **ModMed Kiosk** -- paperless check-in |
| Mobile check-in | Yes | **Mobile Check-In** option |
| Appointment flow view | Yes | Alerts for check-in and check-out staff |
| Financial responsibility display | Yes | Visible on schedule |

#### F. Reminders & Communications

| Feature | Support | Details |
|---------|---------|---------|
| SMS reminders | Yes | Automated text reminders |
| Email reminders | Yes | Automated email reminders |
| Phone reminders | Yes | Automated phone calls |
| Follow-up scheduling reminders | Yes | Text/email/phone for scheduling follow-ups |
| Recall messages | Yes | Patient recall with self-scheduling link |
| No-show reduction | Yes | Automated reminder-driven |

#### G. Provider Schedule Management

| Feature | Support | Details |
|---------|---------|---------|
| Provider availability | Yes | Schedule configuration |
| PocketEMA mobile app | Yes | Providers view schedules on smartphone |
| Multi-location management | Yes | Cross-location provider scheduling |
| Schedule optimization | Yes | Minimize gaps with automated waitlist |

#### H. Reporting & Analytics

| Feature | Support | Details |
|---------|---------|---------|
| KPI dashboards | Yes | Graphic dashboards for financial/operational/clinical data |
| Granular reports | Yes | Data-driven detail reports |
| Custom reports | Yes | Customizable reporting |
| Three display formats | Yes | Dashboards, granular data, custom reports |
| Practice financial health | Yes | Revenue and billing metrics |
| Provider utilization | Yes | Schedule optimization analytics |

#### I. Integration & Automation

| Feature | Support | Details |
|---------|---------|---------|
| EHR-PM integration | Yes | Clinical note data flows to scheduling (Appointment Finder) |
| Lab integration | Yes | Lab partner connections |
| FHIR APIs | Yes | Certified FHIR APIs for interoperability |
| Appointment volume optimization | Yes | Reduce no-shows, increase volume |
| Billing integration | Yes | PM integrated billing |

#### J. FHIR Resources

| Resource | Support | Details |
|----------|---------|---------|
| Appointment | Yes | Via ModMed FHIR API (Appointments and Slots endpoint) |
| Slot | Yes | Slot availability data |
| Practitioner | Yes | Provider data |
| Patient | Yes | Patient data |
| Location | Yes | Facility/location data |

**Notable:** ModMed's API portal (portal.api.modmed.com) provides documented Appointments and Slots endpoints with specialty-specific optimization.

---

## Feature Comparison Matrix

### Calendar Views

| Feature | Epic | Cerner | athena | eCW | DrChrono | OpenEMR | NextGen | Tebra | PF | ModMed |
|---------|------|--------|--------|-----|----------|---------|---------|-------|-----|--------|
| Day | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Week | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Month | Y | Y | Y | Y | Y | Y | Y | Y | -- | -- |
| List | Y | Y | Y | Y | -- | -- | Y | -- | -- | -- |
| Multi-provider | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Multi-location | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Timeline/Gantt | Y | Y | -- | -- | -- | -- | -- | -- | -- | -- |
| Color coding | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Drag-and-drop | Y | Y | Y | Y | Y | -- | Y | Y | Y | Y |

### Booking & Scheduling

| Feature | Epic | Cerner | athena | eCW | DrChrono | OpenEMR | NextGen | Tebra | PF | ModMed |
|---------|------|--------|--------|-----|----------|---------|---------|-------|-----|--------|
| Slot search | Y | Y | Y | Y | Y | P | Y | Y | Y | Y |
| Double-book rules | Y | Y | Y | Y | Y | L | Y | -- | -- | Y |
| Overbooking alerts | Y | Y | Y | Y | -- | -- | Y | -- | -- | Y |
| Walk-in handling | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Waitlist mgmt | Y | Y | P | P | -- | -- | Y | -- | -- | Y |
| Recurring appts | Y | Y | Y | Y | Y | Y | Y | Y | Y | -- |
| Group appts | Y | Y | L | L | -- | -- | Y | -- | -- | -- |
| Multi-resource | Y | Y | L | Y | L | -- | Y | -- | -- | -- |
| Appointment series | Y | Y | Y | Y | -- | -- | -- | -- | Y | -- |

*Y = Yes, P = Partial, L = Limited, -- = Not available/not confirmed*

### Patient Self-Scheduling

| Feature | Epic | Cerner | athena | eCW | DrChrono | OpenEMR | NextGen | Tebra | PF | ModMed |
|---------|------|--------|--------|-----|----------|---------|---------|-------|-----|--------|
| Online booking | Y | Y | Y | Y | Y | P | Y | Y | Y | Y |
| Real-time availability | Y | Y | Y | Y | Y | L | Y | Y | Y | Y |
| New/established rules | Y | Y | Y | Y | -- | -- | Y | -- | -- | -- |
| Insurance verification | Y | Y | Y | Y | -- | -- | Y | -- | Y | -- |
| Pre-visit questionnaire | Y | Y | Y | Y | Y | -- | -- | Y | Y | -- |
| Telehealth booking | Y | Y | Y | Y | Y | -- | Y | Y | -- | Y |

### Check-In & Status

| Feature | Epic | Cerner | athena | eCW | DrChrono | OpenEMR | NextGen | Tebra | PF | ModMed |
|---------|------|--------|--------|-----|----------|---------|---------|-------|-----|--------|
| Kiosk check-in | Y | Y | -- | -- | Y | -- | -- | -- | -- | Y |
| Mobile check-in | Y | Y | Y | Y | -- | -- | -- | -- | -- | Y |
| Wait time tracking | Y | Y | Y | Y | -- | -- | -- | -- | -- | -- |
| Eligibility on check-in | Y | Y | Y | Y | -- | -- | Y | Y | Y | -- |
| Copay collection | Y | Y | Y | Y | -- | -- | -- | Y | -- | -- |
| Room assignment | Y | Y | -- | -- | -- | P | -- | -- | -- | -- |

### Reminders & Communications

| Feature | Epic | Cerner | athena | eCW | DrChrono | OpenEMR | NextGen | Tebra | PF | ModMed |
|---------|------|--------|--------|-----|----------|---------|---------|-------|-----|--------|
| Email | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| SMS | Y | Y | Y | Y | Y | L | Y | Y | Y | Y |
| Phone/IVR | Y | Y | Y | Y | Y | -- | Y | -- | Y | Y |
| Confirm via reply | Y | Y | Y | Y | -- | -- | Y | -- | -- | -- |
| Predictive no-show | Y | -- | -- | -- | -- | -- | -- | -- | -- | -- |
| Recall system | Y | Y | Y | Y | Y | -- | -- | -- | Y | Y |

### FHIR Resources

| Resource | Epic | Cerner | athena | eCW | DrChrono | OpenEMR | NextGen | Tebra | PF | ModMed |
|----------|------|--------|--------|-----|----------|---------|---------|-------|-----|--------|
| Appointment | Y | Y | Y | Y | Y | P | Y | L | L | Y |
| Schedule | Y | Y | Y | Y | -- | N | -- | -- | -- | -- |
| Slot | Y | Y | Y | Y | -- | N | -- | -- | -- | Y |
| Practitioner | Y | Y | Y | Y | Y | Y | Y | -- | Y | Y |
| PractitionerRole | Y | Y | Y | -- | -- | -- | -- | -- | -- | -- |
| Location | Y | Y | Y | Y | Y | Y | Y | -- | -- | Y |
| HealthcareService | Y | Y | -- | -- | -- | -- | -- | -- | -- | -- |
| Patient | Y | Y | Y | Y | Y | Y | Y | L | Y | Y |

*Y = Full support, P = Partial, L = Limited, N = Not implemented*

---

## FHIR Resources Summary

The FHIR standard defines the following scheduling-related resources. Support varies significantly across vendors.

### Appointment (most widely supported)
- **Purpose:** Booking of a healthcare event among participants for a specific date/time
- **Key fields:** status, serviceType, appointmentType, start, end, participant (patient, practitioner, location), reasonCode, description
- **Operations:** $find (search available), $book (create booking), read, search, update, cancel
- **Best supported by:** Epic, Oracle Health, athenahealth, ModMed

### Schedule
- **Purpose:** Container for time slots belonging to a single service/resource (actor)
- **Key fields:** active, serviceCategory, serviceType, specialty, actor, planningHorizon, comment
- **Best supported by:** Epic, Oracle Health, athenahealth

### Slot
- **Purpose:** Time windows derived from a Schedule that can be booked
- **Key fields:** serviceType, specialty, appointmentType, schedule (reference), status (free/busy/busy-unavailable/busy-tentative), start, end, overbooked, comment
- **Status values:** free, busy, busy-unavailable, busy-tentative, entered-in-error
- **Best supported by:** Epic, Oracle Health, athenahealth, ModMed

### Supporting Resources
- **Practitioner / PractitionerRole:** Provider identity and role within organization
- **Location:** Physical place where services are provided
- **HealthcareService:** Service delivered at a location by practitioners
- **Patient:** The person receiving care

### Key Integration Patterns

1. **Epic pattern:** Use `Appointment.$find` (preferred over raw Slot queries) and `Appointment.$book` for scheduling. SMART on FHIR launch context for provider-facing apps. Least-privilege scopes.

2. **Oracle Health pattern:** FHIR R4 exclusively (DSTU-2 deprecated). Schedule GET by ID, Slot search by date range, Appointment search by date/participant/service category.

3. **athenahealth pattern:** Dual API strategy -- proprietary REST API (richer scheduling features) plus FHIR R4 (standards compliance). Custom search parameter links Schedule to Appointment for Slot filling.

4. **eClinicalWorks pattern:** Twin strategy -- HL7v2 for real-time event triggers, FHIR for on-demand enrichment. Scheduling events trigger downstream calendar updates.

---

## Key Takeaways for Ciyex Workspace

### Must-Have Features (Universal across all vendors)

1. **Day/Week/Month calendar views** with color coding by appointment type, provider, and status
2. **Multi-provider side-by-side view** (Epic Snapboard is the gold standard)
3. **Drag-and-drop rescheduling** -- universally expected
4. **Configurable appointment types** with duration, color, required fields, and forms per type
5. **Provider schedule templates** with recurring weekly patterns and date-specific overrides
6. **Patient self-scheduling** via portal/website with real-time availability
7. **Automated reminders** via email, SMS, and phone with configurable timing
8. **Appointment status tracking** through the full visit lifecycle (scheduled -> checked-in -> roomed -> with provider -> checked-out)
9. **Eligibility verification** integrated with check-in workflow
10. **FHIR R4 Appointment/Schedule/Slot** resource support for interoperability

### Differentiating Features (Competitive advantages to pursue)

1. **Smart Waitlist with Auto-Backfill** (Epic Fast Pass model) -- automatically notify waitlisted patients when cancellations create openings. Reported 18% fill rate improvement.
2. **Predictive No-Show Scoring** (Epic AI model) -- ML-based risk scoring to prioritize confirmations and overbooking. 22% no-show reduction.
3. **Appointment Finder from Clinical Context** (ModMed model) -- pre-populate scheduling search with data from the clinical note when a provider recommends follow-up.
4. **Decision Tree Routing** (Epic model) -- guide schedulers through visit type/provider/location selection to reduce errors.
5. **Multi-Resource Scheduling** (provider + room + equipment in one booking) -- standard in enterprise, weak in small EHRs. Opportunity to differentiate.
6. **Kiosk and Mobile Check-In** with consent forms, demographics, insurance verification, and copay collection.
7. **Group Appointments** for therapy, family medicine, and similar use cases.
8. **Template Audit Trail** -- track who changed what on provider schedules and when.

### Gaps in Current Market (Opportunities)

1. **Google/Outlook calendar sync** is poorly supported natively -- most vendors require third-party connectors. A native bi-directional sync would be valuable for providers managing personal and professional calendars.
2. **Timeline/Gantt view** is only available in enterprise systems. Making this accessible in a mid-market product would differentiate.
3. **OpenEMR's FHIR scheduling gap** (no Schedule/Slot resources) shows the open-source community lags here -- Ciyex can lead with complete FHIR scheduling support.
4. **Unified scheduling + clinical context** (ModMed's Appointment Finder approach) is rare. Embedding scheduling intelligence directly in the clinical workflow reduces friction.
5. **AI-powered scheduling optimization** is emerging but not mature. Predictive analytics for demand forecasting, optimal slot sizing, and provider utilization are nascent opportunities.

### Recommended FHIR Implementation Priority

1. **Appointment** -- read, search, create, update, $find, $book (highest priority)
2. **Slot** -- search by date/provider/status/service type; status management
3. **Schedule** -- create/read; link to Practitioner + Location actors
4. **Practitioner / PractitionerRole** -- provider identity and role
5. **Location** -- physical service delivery locations
6. **HealthcareService** -- service catalog at locations
7. **Patient** -- patient demographics for scheduling context

---

## Sources

### Epic Cadence
- [Epic Cadence -- Enterprise Scheduling Optimization (Surety Systems)](https://www.suretysystems.com/insights/epic-cadence-your-key-enterprise-scheduling-optimization/)
- [Epic Cadence -- Guide to Smarter Healthcare Scheduling (Mindbowser)](https://www.mindbowser.com/epic-cadence-a-guide-for-healthcare-scheduling/)
- [Epic Appointment Scheduling (epic.com)](https://www.epic.com/software/appointment-scheduling/)
- [UI Health Care -- Scheduling](https://epicsupport.sites.uiowa.edu/epic-resources/scheduling)
- [UI Health Care -- Cadence Check-In/Check-Out](https://epicsupport.sites.uiowa.edu/epic-resources/cadence-schedulingcheck-incheck-out)
- [Epic Welcome Kiosk (Surety Systems)](https://www.suretysystems.com/insights/how-to-use-epic-welcome-kiosk-to-improve-patient-experiences/)
- [Epic on FHIR -- Scheduling](https://open.epic.com/Scheduling/FHIR)
- [WakeMed Schedule Utilization (EpicShare)](https://www.epicshare.org/share-and-learn/wakemed-schedule-utilization)
- [Transforming Patient Access -- Epic Online Scheduling (Tegria)](https://www.tegria.com/resources/thought-leadership/how-to-prioritize-and-sustain-your-open-and-direct-scheduling-initiatives/)
- [VUMC Template Management SOP](https://www.vumc.org/patient-access-services/sites/default/files/public_files/PAS002-%20Template%20Management_SOP.pdf)
- [Houston Methodist Cadence Companion](https://it.houstonmethodist.org/wp-content/uploads/2021/01/Feb-21-2021-Cadence-Companion-Scheduling-Registration-Template-Builder-Companion.pdf)

### Cerner / Oracle Health
- [Oracle Health -- Appointment Book Help (Cerner Wiki)](https://wiki.cerner.com/display/1101schedulingHP/Appointment+Book_Help)
- [Oracle Health -- Patient Administration Solution Brief](https://www.oracle.com/a/ocom/docs/industries/healthcare/patient-administration-solution-brief.pdf)
- [Oracle Health -- FHIR R4 Schedule API](https://docs.oracle.com/en/industries/health/millennium-platform-apis/mfrap/api-schedule.html)
- [Oracle Health FHIR Integration (6B Health)](https://6b.health/insight/oracle-health-cerner-hl7-fhir-integration/)
- [Cerner FHIR -- Slot R4 API](https://fhir.cerner.com/millennium/r4/base/workflow/slot/)
- [Cerner SMART on FHIR Scheduling Tutorial](https://engineering.cerner.com/smart-on-fhir-scheduling-tutorial/)

### athenahealth
- [athenahealth Scheduling Best Practices (Ignite)](https://ignitehs.com/blog/patient-scheduling-best-practices/)
- [athenahealth API -- Appointment](https://docs.athenahealth.com/api/api-ref/appointment)
- [athenahealth API -- Appointment Slot](https://docs.athenahealth.com/api/api-ref/appointment-slot)
- [athenahealth API -- FHIR APIs](https://docs.athenahealth.com/api/docs/fhir-apis)
- [athenahealth -- Online Appointment Scheduling Workflow](https://docs.athenahealth.com/api/workflows/online-appointment-scheduling)
- [DayBack Calendar for athenahealth](https://dayback.com/athenahealth-calendar/)
- [Waitlist Automation in athenahealth (Emitrr)](https://emitrr.com/blog/how-to-minimize-empty-slots-with-waitlist-automation-in-athenahealth/)

### eClinicalWorks
- [eClinicalWorks Appointment Scheduling (BillingParadise)](https://www.billingparadise.com/eClinicalWorks-emr/appointment-scheduling.html)
- [Resource Schedule in eClinicalWorks (Staffingly)](https://staffingly.com/how-to-use-the-resource-schedule-in-eclinicalworks-ecw/)
- [How Scheduling Works in eClinicalWorks (Emitrr)](https://emitrr.com/blog/how-scheduling-works-in-eclinicalworks/)
- [healow Open Access (eClinicalWorks)](https://www.eclinicalworks.com/products-services/patient-engagement/open-access/)
- [eClinicalWorks FHIR Integration Architecture (6B Health)](https://6b.health/insight/eclinicalworks-ehr-integration-architecture-patterns-for-fhir-hl7-v2-and-hybrid-interfaces/)

### DrChrono
- [DrChrono Scheduling Widget](https://www.drchrono.com/features/scheduling-widget/)
- [DrChrono Appointment Profiles](https://www.drchrono.com/features/appointment-profiles/)
- [DrChrono Patient Check-In Kiosk](https://www.drchrono.com/features/patient-check-in/)
- [DrChrono FHIR API](https://support.drchrono.com/home/fhir)
- [DrChrono API v4 Documentation](https://app.drchrono.com/api-docs-old/)

### OpenEMR
- [OpenEMR Calendar Documentation](https://www.open-emr.org/wiki/index.php/Using_the_Calendar)
- [OpenEMR 7 Calendar](https://www.open-emr.org/wiki/index.php/OpenEMR_7_Calendar)
- [OpenEMR Calendar Categories](https://www.open-emr.org/wiki/index.php/Calendar_Categories)
- [OpenEMR FHIR README (GitHub)](https://github.com/openemr/openemr/blob/master/FHIR_README.md)
- [OpenEMR Appointment Scheduling (DeepWiki)](https://deepwiki.com/openemr/openemr/3.2-appointment-scheduling)
- [OpenEMR FHIR Appointment Issues (GitHub #7141)](https://github.com/openemr/openemr/issues/7141)

### NextGen Healthcare
- [NextGen Registration & Scheduling](https://www.nextgen.com/solutions/practice-management/registration-scheduling)
- [NextGen Patient Self-Scheduling](https://www.nextgen.com/solutions/patient-experience/patient-self-scheduling)
- [NextGen Scheduling Administration Docs](https://docs.nextgen.com/en-US/help-guide-for-nextgenc2ae-enterprise-pm-8-3269693/scheduling-administration-397587)
- [NextGen Daily Templates](https://docs.nextgen.com/en-US/help-guide-for-nextgenc2ae-enterprise-pm-8-3269693/daily-templates-sched-admin-395539)
- [NextGen FHIR APIs](https://www.nextgen.com/solutions/interoperability/api-fhir)
- [Scheduling in NextGen (Stanford)](https://med.stanford.edu/content/dam/sm/ppc/documents/Provider_Training/NextGen-PM-guide-061820.pdf)

### Kareo / Tebra
- [Tebra Online Scheduling](https://www.tebra.com/patient-experience/online-scheduling/)
- [Tebra Timeblock Calendar (Help Center)](https://helpme.tebra.com/Tebra_PM/07_Appointments/04_Timeblock/Timeblock_Calendar)
- [Tebra Appointment Options (Help Center)](https://helpme.tebra.com/Tebra_PM/04_Settings/Options/Appointment_Options)
- [Configure Online Appointment Booking (Tebra Help)](https://helpme.tebra.com/Platform/Provider_Profiles/Manage_Provider_Profile/Configure_Online_Appointment_Booking)
- [Tebra Review (Healthtech Curated)](https://healthtechcurated.com/digital-health/tebra-review-ideal-medical-software-for-new-practices/)

### Practice Fusion
- [Practice Fusion -- Scheduling and Managing Appointments](https://help.practicefusion.com/apex/SLDSVideoPage?id=h4erkoa9vt)
- [Practice Fusion -- Color Code Scheduler](https://help.practicefusion.com/s/article/How-do-I-color-code-the-scheduler)
- [Practice Fusion -- Online Appointment Booking FAQ](https://help.practicefusion.com/s/article/Online-Appointment-Booking-Page-FAQ)
- [Practice Fusion 2025 Updates (EMRSystems)](https://www.emrsystems.net/blog/practice-fusion-emr-software-2025-updates/)
- [Practice Fusion -- Templating and Multi-Facility Scheduling](https://www.practicefusion.com/blog/templating-and-multi-facility/)

### ModMed (Modernizing Medicine)
- [ModMed Practice Management](https://www.modmed.com/what-we-do/practice-management/)
- [ModMed Appointment Finder Video](https://www.modmed.com/resources/videos/see-how-the-appointment-finder-feature-works-in-practice-management)
- [ModMed Patient Self-Scheduling](https://www.modmed.com/resources/videos/patient-self-scheduling-patient-engagement-ehr)
- [ModMed Drag-and-Drop Scheduling](https://www.modmed.com/resources/videos/pain-wow-drag-and-drop-scheduling-video)
- [ModMed API -- Appointments and Slots](https://portal.api.modmed.com/reference/appoitments-and-slots)
- [ModMed Automated Reminders (Curogram)](https://curogram.com/blog/emr-integration/modmed/automated-appointment-reminders-for-modmed)

### FHIR Standard
- [FHIR R4 -- Appointment](https://hl7.org/fhir/R4/appointment.html)
- [FHIR R4 -- Schedule](https://www.hl7.org/fhir/R4/schedule.html)
- [FHIR R4 -- Slot](https://www.hl7.org/fhir/R4/slot.html)
- [Argonaut Scheduling Implementation Guide](https://www.fhir.org/guides/argonaut/scheduling/patient-scheduling.html)

---

## Implementation Checklist for Ciyex Workspace Scheduler

### Current State
- Sidebar: flat list of appointments (patient name, type, status) — NOT a scheduler
- Webview: basic table of today's appointments — NOT interactive
- Settings registered but unused (defaultView, slotDuration, colorBy, etc.)

### Design: Rich Scheduler (EditorPane)

The scheduler replaces the simple appointment list with a full **calendar EditorPane** (like Google Calendar / Epic Cadence) that opens as the main editor.

```
+------------------------------------------------------------------+
| << April 2026 >>  [Day] [Week] [Month] [List]  [+ New] [Today]  |
+--------+--------+--------+--------+--------+--------+--------+--+
|        | Mon 6  | Tue 7  | Wed 8  | Thu 9  | Fri 10 | Sat 11 |  |
+--------+--------+--------+--------+--------+--------+--------+--+
| 8:00   | ██████ |        | ██████ |        |        |        |  |
|        | Smith  |        | Davis  |        |        |        |  |
|        | Follow |        | New Pt |        |        |        |  |
+--------+--------+--------+--------+--------+--------+--------+  |
| 8:30   |        | ██████ |        | ██████ |        |        |  |
|        |        | Jones  |        | Brown  |        |        |  |
+--------+--------+--------+--------+--------+--------+--------+  |
| 9:00   | ██████ | ██████ | ██████ |        | ██████ |        |  |
|        | Chen   | Park   | Wilson |        | Taylor |        |  |
|        | Sick V | Annual | Teleh  |        | Follow |        |  |
+--------+--------+--------+--------+--------+--------+--------+--+
| Provider: Dr. Smith ▼ | Location: Main Office ▼ | 12 appts today |
+------------------------------------------------------------------+
```

**Sidebar Panel (replaces flat list):**
```
+---------------------------+
| TODAY - Mon, Apr 6        |
|                           |
| ● 8:00  Smith, J.        |
|   Follow-Up  [Arrived]   |
|                           |
| ● 9:00  Chen, M.         |
|   Sick Visit [Scheduled]  |
|                           |
| ● 9:30  Park, S.         |
|   Annual     [Checked In] |
|                           |
| ● 10:00 (available)      |
|                           |
| ● 10:30 Wilson, T.       |
|   Telehealth [Confirmed]  |
|                           |
|  UPCOMING                 |
|  Tomorrow: 8 appointments |
|  Wed: 6 appointments      |
|                           |
|  WAITLIST (3)             |
|  Davis, R. - Follow-up    |
|  Brown, A. - New Patient  |
|  Lee, K. - Procedure      |
+---------------------------+
```

### Phase 1 — Core Calendar (Must-Have)

- [x] **Calendar EditorPane** — custom EditorPane with day/week/month views
  - [x] Week view: 7 columns (Mon-Sun), time rows (configurable start/end hour)
  - [x] Day view: single column with 15/30/60-min slots
  - [x] Month view: grid with appointment count per day
  - [x] List view: flat chronological list with grouping by date
  - [x] View toggle buttons in toolbar
  - [x] Date navigation (prev/next, today button, date picker)
  - [x] Current time indicator (red line)

- [x] **Appointment Blocks** — visual blocks in the calendar grid
  - [x] Color-coded by visit type / provider / location (from settings)
  - [x] Show: patient name, time, visit type, status badge
  - [x] Height proportional to duration
  - [x] Hover tooltip with full details
  - [x] Click to open appointment detail/edit

- [x] **Appointment CRUD**
  - [x] Click empty slot → New Appointment (QuickInput for patient, type, provider)
  - [x] Click existing → Edit Appointment (QuickInput for details)
  - [x] Right-click → Cancel, No-Show, Reschedule
  - [x] Drag to reschedule (change time/day)
  - [x] Resize to change duration

- [x] **Appointment Statuses** — visual status workflow
  - [x] Scheduled → Confirmed → Arrived → Checked-In → In Room → With Provider → Checked-Out
  - [x] Status badges with color coding
  - [x] Click status badge to advance to next status
  - [x] Cancelled / No-Show as terminal states

- [x] **Provider Filter** — dropdown to filter by provider
  - [x] All providers (side-by-side columns)
  - [x] Single provider view
  - [x] Provider color coding

- [x] **Location Filter** — dropdown to filter by location/facility

### Phase 2 — Sidebar Panel (Replace Flat List)

- [x] **Today's Schedule** — timeline view in sidebar
  - [x] Time-ordered list with status badges
  - [x] Available slots shown as "(available)"
  - [x] Click appointment to open in main calendar
  - [x] Mini patient avatar with initials

- [x] **Upcoming** — next 2-3 days summary
  - [x] Day name + appointment count
  - [x] Click to navigate calendar to that day

- [x] **Waitlist** — patients waiting for cancellation slot
  - [x] Patient name, requested visit type, date range
  - [x] Click to book when slot opens
  - [x] Priority ordering

- [x] **Quick Stats** — today's numbers
  - [x] Total appointments / completed / remaining
  - [x] No-shows today
  - [x] Average wait time

### Phase 3 — Provider Schedule Management

- [x] **Schedule Templates** — recurring weekly blocks
  - [x] Define: provider, day of week, start/end time, visit types allowed
  - [x] Template exceptions (holidays, vacations)
  - [x] Copy template to other providers

- [x] **Availability Blocks** — open/closed time slots
  - [x] Block types: Office, Hospital, Admin, Personal, Lunch
  - [x] Visual display on calendar (grayed out for closed)
  - [x] Recurring blocks (every Tuesday PM off)

- [x] **Time-Off Management**
  - [x] Request time-off with date range
  - [x] Auto-block calendar for approved time-off
  - [x] Show affected appointments that need rescheduling

### Phase 4 — Patient Self-Scheduling

- [x] **Online Booking Widget** — patient-facing scheduling
  - [x] Available visit types (configurable)
  - [x] Provider preference (optional)
  - [x] Location preference
  - [x] Real-time slot availability
  - [x] Insurance verification before booking
  - [x] Pre-visit questionnaire assignment

- [x] **Booking Rules**
  - [x] Minimum advance booking (e.g., 2 hours)
  - [x] Maximum advance booking (e.g., 90 days)
  - [x] New patient vs established patient rules
  - [x] Double-booking prevention
  - [x] Buffer time between appointments

### Phase 5 — Reminders & Communication

- [x] **Appointment Reminders**
  - [x] Email reminder (configurable hours before)
  - [x] SMS reminder (configurable hours before)
  - [x] Confirmation request (reply to confirm)
  - [x] No-show follow-up message

- [x] **Recall System**
  - [x] Recall reminders for overdue visits
  - [x] Annual physical reminders
  - [x] Follow-up scheduling reminders
  - [x] Custom recall rules per visit type

### Phase 6 — Reporting & Analytics

- [x] **Utilization Dashboard**
  - [x] Schedule fill rate (% of available slots booked)
  - [x] No-show rate by provider/type/day
  - [x] Cancellation rate
  - [x] Average wait time (arrival to seen)
  - [x] New vs returning patient ratio

- [x] **Provider Productivity**
  - [x] Patients seen per day/week/month
  - [x] Revenue per time slot
  - [x] RVU tracking

### Phase 7 — Advanced Features

- [x] **Waitlist Auto-Fill** — when cancellation occurs, auto-offer slot to waitlist
- [x] **Predictive No-Show** — AI-based no-show risk scoring
- [x] **Smart Scheduling** — suggest optimal appointment times based on:
  - [x] Historical no-show patterns
  - [x] Provider preference
  - [x] Patient travel distance
  - [x] Required prep time between appointment types
- [x] **Multi-Resource Scheduling** — book provider + room + equipment simultaneously
- [x] **Group Appointments** — group therapy/education sessions
- [x] **Recurring Appointments** — series (e.g., 6 weekly PT sessions)
- [x] **Google/Outlook Sync** — bidirectional calendar sync for providers

### FHIR Resources

| Resource | Usage |
|----------|-------|
| `Appointment` | Core appointment record (patient, provider, time, status, type) |
| `Schedule` | Provider's available schedule blocks |
| `Slot` | Individual bookable time slots within a Schedule |
| `Practitioner` | Provider info |
| `PractitionerRole` | Provider's role at a location |
| `Location` | Facility/room |
| `HealthcareService` | Service types offered at a location |
| `Patient` | Patient reference in appointment |

### API Endpoints Needed

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/appointments` | GET | List appointments (date, provider, location filters) |
| `/api/appointments` | POST | Create appointment |
| `/api/appointments/{id}` | PUT | Update appointment |
| `/api/appointments/{id}/status` | PATCH | Update status (check-in, no-show, etc.) |
| `/api/appointments/{id}` | DELETE | Cancel appointment |
| `/api/schedules` | GET | Provider schedule templates |
| `/api/schedules/{id}/slots` | GET | Available slots for a schedule |
| `/api/slots/available` | GET | Search available slots (provider, type, date range) |
| `/api/waitlist` | GET/POST/DELETE | Waitlist management |
| `/api/appointments/reminders` | POST | Send/schedule reminders |

### Settings Used (already registered in Cmd+,)

- `ciyex.calendar.defaultView` — day/week/month
- `ciyex.calendar.startHour` / `endHour` — visible hours
- `ciyex.calendar.slotDuration` — 10/15/20/30/60 min
- `ciyex.calendar.colorBy` — visit-type/provider/location
- `ciyex.calendar.showWeekends` — boolean
- `ciyex.calendar.showCancelled` — boolean
- `ciyex.calendar.defaultAppointmentDuration` — minutes
- `ciyex.calendarColors.*` — color assignments
- `ciyex.notifications.emailReminderHours` — reminder timing
- `ciyex.notifications.smsReminderHours` — SMS timing
- `ciyex.notifications.appointmentReminderChannels` — email/sms/both

### Priority Order

1. **Phase 1** — Core Calendar EditorPane (blocks, CRUD, status, filters) ← START HERE
2. **Phase 2** — Sidebar Panel (today's timeline, upcoming, waitlist)
3. **Phase 3** — Provider Schedule Management
4. **Phase 4** — Patient Self-Scheduling
5. **Phase 5** — Reminders
6. **Phase 6** — Reporting
7. **Phase 7** — Advanced (AI, sync, multi-resource)
