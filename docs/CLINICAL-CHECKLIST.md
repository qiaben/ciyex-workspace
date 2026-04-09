# Clinical Menus — Implementation Checklist

## EditorInputs
- [ ] PrescriptionsEditorInput
- [ ] ImmunizationsEditorInput
- [ ] ReferralsEditorInput
- [ ] CarePlansEditorInput
- [ ] CdsEditorInput
- [ ] AuthorizationsEditorInput

## EditorPanes
- [ ] PrescriptionsEditor — table with status tabs, priority filter, refill/discontinue actions
- [ ] ImmunizationsEditor — table with CVX codes, create/edit form
- [ ] ReferralsEditor — table with status workflow, urgency filter
- [ ] CarePlansEditor — card view with goals/interventions
- [ ] CdsEditor — rules tab + alerts tab, toggle active
- [ ] AuthorizationsEditor — prior auth with approve/deny/appeal

## Registration
- [ ] Register all 6 EditorPanes
- [ ] Register all 6 EditorInputs
- [ ] Add F1 commands for each
- [ ] Replace GenericListPane entries with click-to-open-editor

## GenericListPane (keep as-is, already working)
- [x] Labs Orders → `/api/lab-order/search`
- [x] Labs Results → `/api/lab-results`
- [x] Education → `/api/fhir-resource/education`

## Compile and test
- [ ] Zero TS errors
- [ ] Launch and verify
