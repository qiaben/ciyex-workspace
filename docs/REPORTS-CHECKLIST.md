# Reports — Implementation Checklist

## Foundation
- [x] ReportsEditorInput (reportKey, reportLabel, category params)
- [x] ReportsEditor base with chart/stats helpers
- [x] Bar chart renderer (CSS flex, no external lib)
- [x] Pie chart renderer (CSS conic-gradient)
- [x] KPI stat cards renderer
- [x] Sidebar click → opens report in editor tab
- [x] Register ReportsEditor + ReportsEditorInput

## Clinical Reports (9)
- [x] Patient Demographics — KPIs (total/active/inactive) + gender pie chart
- [x] Encounter Summary — KPIs + encounters by type bar chart
- [x] Lab Orders & Results — KPIs + status bar chart
- [x] Medication & Prescriptions — KPIs (active/completed/on-hold/discontinued) + bar chart
- [x] Referral Tracking — KPIs from stats endpoint + status bar chart
- [x] Immunizations — KPIs + top vaccines bar chart
- [x] Care Gaps — placeholder (coming soon)
- [x] No-Show Analysis — placeholder (coming soon)
- [x] Problem List — placeholder (coming soon)

## Financial Reports (4)
- [x] Revenue Overview — KPI cards (placeholder, needs RCM module)
- [x] Payer Mix — KPI cards (placeholder, needs RCM module)
- [x] CPT Utilization — KPI cards (placeholder, needs RCM module)
- [x] AR Aging — KPI cards (placeholder, needs RCM module)

## Operational Reports (3)
- [x] Appointment Volume — KPIs + status bar chart
- [x] Provider Productivity — KPIs + encounters-per-provider bar chart
- [x] Document Completion — placeholder (coming soon)

## Compliance Reports (2)
- [x] Quality Measures — placeholder (coming soon)
- [x] Audit Log — placeholder (coming soon)

## Population Health (2)
- [x] Risk Stratification — placeholder (coming soon)
- [x] Disease Registry — placeholder (coming soon)

## Administrative (2)
- [x] Portal Usage — placeholder (coming soon)
- [x] AI Usage — placeholder (coming soon)

## Compile and test
- [x] Zero TS errors
- [ ] Visual test — verify charts render with real data
