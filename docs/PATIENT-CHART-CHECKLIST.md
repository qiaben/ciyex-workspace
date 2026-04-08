# Patient Chart & Clinical Features — Implementation Checklist

All APIs use FHIR endpoints (`/api/fhir-resource/*`). UI driven by `.ciyex/chart-layout.json` + `.ciyex/fields/*.json` + `.ciyex/encounter.json`. VS Code EditorPane/ViewPane patterns with `var(--vscode-*)` theming.

**Detail view pattern**: Clicking an entry (encounter, appointment, etc.) from a list inside the patient chart opens the detail in the **right editor group** (split view). Patient chart stays visible on the left. Uses `IEditorService.openEditor(input, { }, SIDE_GROUP)`.

```
┌──────────────────────┬──────────────────────┐
│ Patient Chart        │ Encounter Detail     │
│ [Clinical] [General] │ CC: Chest pain       │
│ Encounters  Problems │ HPI: 45yo male...    │
│ ┌──────────────────┐ │ Vitals: BP 120/80    │
│ │▶ 2/19 Office     │→│ Assessment: HTN      │
│ │  2/18 Follow-up  │ │ Plan: Continue meds  │
│ └──────────────────┘ │                      │
└──────────────────────┴──────────────────────┘
```

## Phase 1: Foundation (EditorInputs, Commands, Navigation)

- [ ] 1. Create `PatientChartEditorInput` extending `BaseCiyexInput` with patientId + patientName
- [ ] 2. Create `EncounterFormEditorInput` extending `BaseCiyexInput` with patientId + encounterId
- [ ] 3. Register both EditorInputs in `ciyexEditorInput.ts`
- [ ] 4. Register `ciyex.openPatientChart` command (takes patientId, patientName) → opens PatientChartEditor in main group
- [ ] 5. Register `ciyex.openEncounter` command (takes patientId, encounterId) → opens EncounterEditor in SIDE_GROUP (right split)
- [ ] 6. Register EditorPane descriptors in `ciyexEditors.contribution.ts`
- [ ] 7. Test: clicking patient in sidebar opens chart tab, clicking encounter opens encounter tab

## Phase 2: Patient List Enhancement

- [ ] 8. Search-as-you-type with 300ms debounce (existing `PatientListPane`)
- [ ] 9. API: `/api/fhir-resource/patients?page=0&size=50` with search param
- [ ] 10. Show avatar circle (colored by name hash), name, DOB, gender, MRN
- [ ] 11. Status badge (Active/Inactive) with color coding
- [ ] 12. Recent patients section (top 5, stored in localStorage)
- [ ] 13. Empty state: "No patients found" with search hint
- [ ] 14. Click row → `ciyex.openPatientChart` command
- [ ] 15. Test: search, pagination, click-to-chart navigation

## Phase 3: Patient Chart Editor (main editor area)

- [ ] 16. Create `PatientChartEditor` extending `EditorPane`
- [ ] 17. Patient header bar: name, DOB (age), MRN, gender, status, phone, allergies count
- [ ] 18. Load `chart-layout.json` via file service for category/tab structure
- [ ] 19. Render category bar (Overview | Clinical | General | Financial) — sticky, scrollable
- [ ] 20. Render sub-tab bar per category (e.g., Clinical → Encounters, Problems, Allergies, Meds...)
- [ ] 21. Active tab state management (selectedCategory + selectedTab)
- [ ] 22. Content area: call `GenericFhirTabRenderer` with current tab config
- [ ] 23. Tab switching is instant (no API reload — cache loaded tab data)
- [ ] 24. Patient header stays fixed while scrolling content
- [ ] 25. Test: open chart, switch categories, switch sub-tabs, verify data loads

## Phase 4: Generic FHIR Tab Renderer

- [ ] 26. Create `GenericFhirTabRenderer` class (reusable, not an EditorPane)
- [ ] 27. Input: tabKey, patientId, fhirResources[], container HTMLElement
- [ ] 28. Load field config: read `.ciyex/fields/{tabKey}.json` via file service
- [ ] 29. Load FHIR data: `GET /api/fhir-resource/{resource}/patient/{patientId}` for each resource
- [ ] 30. Render sections from field config (collapsible, titled, CSS grid layout)
- [ ] 31. Render fields within sections using `FieldRenderer`
- [ ] 32. Read mode: display field values with labels
- [ ] 33. Edit mode: inline editing (click field to edit)
- [ ] 34. Save: `PUT /api/fhir-resource/{resource}/patient/{patientId}/{resourceId}`
- [ ] 35. Loading state: skeleton shimmer while data loads
- [ ] 36. Empty state: "No {resource} records" with Add button
- [ ] 37. Test: render demographics tab, render vitals tab, edit + save a field

## Phase 5: Field Renderer (27 field types)

- [ ] 38. Create `FieldRenderer` — maps field.type to DOM element
- [ ] 39. Basic types: text, number, date, datetime, email, phone, boolean/toggle
- [ ] 40. Select types: select (dropdown), multiselect, radio, checkbox
- [ ] 41. Text areas: textarea with configurable rows
- [ ] 42. Lookup type: search input → API call → dropdown results → select → auto-fill related fields
- [ ] 43. Coded type: ICD-10/CPT code search with autocomplete (`/api/codes/icd10/search`)
- [ ] 44. Computed type: readonly, auto-calculate (e.g., BMI from weight + height)
- [ ] 45. Quantity type: number + unit display (from FHIR mapping)
- [ ] 46. File type: upload button with preview
- [ ] 47. Validation: required indicator, pattern validation, min/max, display errors
- [ ] 48. FHIR mapping: preserve `fhirMapping` metadata for save/load path resolution
- [ ] 49. Column span: respect `colSpan` in CSS grid (1-4 columns)
- [ ] 50. Test: render each field type, validate required, edit + save

## Phase 6: Encounter Form Editor

- [ ] 51. Create `EncounterFormEditor` extending `EditorPane`
- [ ] 52. Load encounter schema from `.ciyex/encounter.json`
- [ ] 53. Load encounter data: `GET /api/fhir-resource/encounter-form/patient/{patientId}/{compositionId}`
- [ ] 54. Render encounter header: patient name, date, provider, visit type, status
- [ ] 55. Render sections from encounter.json (CC, HPI, ROS, PMH, Vitals, Assessment, Plan, etc.)
- [ ] 56. Each section collapsible with expand/collapse toggle
- [ ] 57. Special renderers: ROS grid, Physical Exam grid, Diagnosis list, Plan items
- [ ] 58. SOAP note section: Subjective, Objective, Assessment, Plan textareas
- [ ] 59. Vitals section: auto-compute BMI from weight + height
- [ ] 60. Auto-save: debounced save on field change (PUT to fhir-resource/encounter-form endpoint)
- [ ] 61. Status workflow: Draft → ReadyForSignature → Signed → Cosign → Finalized → Locked
- [ ] 62. Sign-off section: provider signature, attestation, date
- [ ] 63. Billing section: ICD-10 diagnosis codes, CPT procedure codes
- [ ] 64. Test: open encounter, fill CC, fill vitals (verify BMI), save, change status

## Phase 7: Encounters List (sidebar + chart tab)

- [ ] 65. Enhance encounters GenericListPane: show date, visit type, provider, status badge
- [ ] 66. API: `GET /api/fhir-resource/encounters/patient/{patientId}?page=0&size=50`
- [ ] 67. Click encounter row → `ciyex.openEncounter` command → opens in right split (SIDE_GROUP)
- [ ] 68. New Encounter button → create encounter form (visit type, date, provider, reason)
- [ ] 69. Encounter creation API: `POST /api/fhir-resource/encounters` with patient reference
- [ ] 70. Chart tab "Encounters": list encounters within the patient chart (same data, different UI)
- [ ] 71. Test: list encounters, create new, open existing, verify data

## Phase 8: Clinical Tabs (Problems, Allergies, Medications, etc.)

- [ ] 72. Problems tab: `.ciyex/fields/problems.json` → `GET /api/fhir-resource/conditions/patient/{id}`
- [ ] 73. Allergies tab: `.ciyex/fields/allergies.json` → `GET /api/fhir-resource/allergy-intolerances/patient/{id}`
- [ ] 74. Medications tab: `.ciyex/fields/medications.json` → `GET /api/fhir-resource/medication-requests/patient/{id}`
- [ ] 75. Vitals tab: `.ciyex/fields/vitals.json` → flowsheet grid view (date columns × vital rows)
- [ ] 76. Lab Results tab: `.ciyex/fields/labs.json` → `GET /api/fhir-resource/lab-orders/patient/{id}`
- [ ] 77. Immunizations tab: `.ciyex/fields/immunizations.json` → `GET /api/fhir-resource/immunizations/patient/{id}`
- [ ] 78. Each tab: Add new record → form from field config → POST to FHIR endpoint
- [ ] 79. Each tab: Edit existing record → inline or modal edit → PUT to FHIR endpoint
- [ ] 80. Each tab: Delete record → confirm dialog → DELETE to FHIR endpoint
- [ ] 81. Test: each clinical tab loads, add/edit/delete a record

## Phase 9: General & Financial Tabs

- [ ] 82. Demographics tab: `fields/demographics.json` → `GET /api/fhir-resource/demographics/patient/{id}/{id}`
- [ ] 83. Appointments tab: `GET /api/fhir-resource/appointments/patient/{id}` — reuse appointment rendering
- [ ] 84. Documents tab: `fields/documents.json` → `GET /api/fhir-resource/document-references/patient/{id}`
- [ ] 85. Insurance tab: `fields/insurance.json` → `GET /api/fhir-resource/insurance-coverage/patient/{id}`
- [ ] 86. Billing tab: claim list, charge entry via FHIR claim resources
- [ ] 87. Test: demographics edit + save, view appointments, upload document

## Phase 10: Polish & Integration

- [ ] 88. Loading states: skeleton shimmer for all data-loading areas
- [ ] 89. Error states: "Failed to load" with retry button
- [ ] 90. Dirty indicator: dot on tab title when unsaved changes exist
- [ ] 91. Keyboard shortcuts: Ctrl+S to save, Escape to cancel edit
- [ ] 92. Print support: encounter print view
- [ ] 93. Breadcrumb: show Patient Name > Tab Name in editor breadcrumb bar
- [ ] 94. Patient chart caching: keep loaded data when switching tabs (don't re-fetch)
- [ ] 95. Responsive layout: handle narrow editor width gracefully
- [ ] 96. Dark theme: verify all field types render correctly in dark mode
- [ ] 97. Remove hardcoded Test@123 password from auth gate
- [ ] 98. Full E2E test: login → patient list → open chart → switch tabs → open encounter → edit → save
