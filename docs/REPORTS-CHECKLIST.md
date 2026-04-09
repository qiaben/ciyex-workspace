# Reports — Implementation Checklist

## Foundation
- [ ] ReportsEditorInput (report type param)
- [ ] ReportsEditor base class (shared: title, date range filter, provider/payer filter, chart area, table area, export)
- [ ] Chart rendering helper (bar, line, pie using HTML/CSS — no external lib)
- [ ] Stats card helper (KPI cards row)

## Clinical Reports (9)
- [ ] Patient Demographics — age/gender/status/insurance breakdown charts
- [ ] Encounter Summary — encounters by type, provider, status + trends
- [ ] Lab Orders & Results — order volume, status, turnaround times
- [ ] Medication & Prescriptions — prescribing patterns, drug classes, refills
- [ ] Referral Tracking — completion rates, turnaround, outgoing/incoming
- [ ] Immunizations — vaccine coverage, compliance rates, overdue
- [ ] Care Gaps — preventive care opportunities, HEDIS measures
- [ ] No-Show Analysis — no-show rates, patterns, impact
- [ ] Problem List — active diagnoses, patient conditions

## Financial Reports (4)
- [ ] Revenue Overview — monthly revenue, charge trends, payer mix
- [ ] Payer Mix — claims by payer, collection rates, denial patterns
- [ ] CPT Utilization — procedure code usage, top procedures, revenue by code
- [ ] AR Aging — aging buckets (0-30, 31-60, 61-90, 91-120, 120+)

## Operational Reports (3)
- [ ] Appointment Volume — booking trends, scheduling utilization
- [ ] Provider Productivity — encounters/revenue per provider, RVU
- [ ] Document Completion — unsigned notes, incomplete encounters

## Compliance Reports (2)
- [ ] Quality Measures — MIPS, performance benchmarking
- [ ] Audit Log — system activity, user actions

## Population Health (2)
- [ ] Risk Stratification — risk scoring, high-risk patients
- [ ] Disease Registry — chronic conditions, outcomes

## Administrative (2)
- [ ] Portal Usage — enrollment, active users, messages
- [ ] AI Usage — token usage, model costs, latency

## Registration & Wiring
- [ ] Register ReportsEditor + ReportsEditorInput
- [ ] Wire sidebar click → opens report in editor
- [ ] Compile and test
