# EHR UI Migration - Implementation Checklist

## Phase 2: Navigation Framework (Current Priority)

### 2.1 Remove Unwanted Default Menus
- [ ] Hide Terminal menu (add `ciyex.showDevMenus` context key gate)
- [ ] Hide Run/Debug menu
- [ ] Hide Selection menu
- [ ] Hide Source Control activity bar item
- [ ] Hide Search activity bar item (replace with patient search)
- [ ] Configure default layout to hide minimap, breadcrumbs

### 2.2 Register EHR Activity Bar Items (ViewContainers)
- [ ] Calendar (scheduling icon)
- [ ] Patients (users icon)
- [ ] Clinical (stethoscope icon) - Encounters, Prescriptions, Labs, Immunizations, Care Plans, Referrals
- [ ] Messaging (message-square icon) - Messages, Fax, Notifications
- [ ] Billing (dollar-sign icon) - Payments, Claims, Authorizations
- [ ] Reports (bar-chart icon)
- [ ] Settings (gear icon) - Admin only

### 2.3 Permission-Based Context Keys (RBAC)
- [ ] Create CiyexPermissionService
- [ ] Set context keys after login: ciyex.perm.scheduling, ciyex.perm.demographics, etc.
- [ ] Set FHIR scope keys: ciyex.fhir.read.Patient, ciyex.fhir.write.Appointment, etc.
- [ ] Set role keys: ciyex.role.admin, ciyex.role.provider, etc.
- [ ] Gate all menus/views with `when` clauses

### 2.4 Add EHR Menu Bar Items
- [ ] Add "Clinical" top-level menu (Patients, Encounters, Prescriptions, Labs)
- [ ] Add "Scheduling" top-level menu (Calendar, Appointments, Recall)
- [ ] Add "Billing" top-level menu (Payments, Claims)
- [ ] Add EHR actions to File menu (New Patient, New Appointment, New Encounter)

### 2.5 Status Bar Items
- [ ] User info (name, role) on right side
- [ ] Practice/tenant name on right side
- [ ] Notification count on right side

### 2.6 API Service
- [ ] Create CiyexApiService (fetch wrapper with auth headers + tenant)
- [ ] Create CiyexMenuService (fetches menu tree from API, registers dynamically)

## Phase 3: Core Screens (WebviewPanel)

### 3.1 Patient List
- [ ] TreeView in Patients ViewContainer
- [ ] Patient search (Cmd+K shortcut)
- [ ] Click patient -> opens Patient Chart editor

### 3.2 Calendar
- [ ] WebviewPanel with embedded calendar (FullCalendar or similar)
- [ ] Opens as editor tab

### 3.3 Patient Chart
- [ ] WebviewPanel with tabbed layout (Demographics, Encounters, Labs, etc.)
- [ ] Tabs configurable via /api/tab-field-config/layout

### 3.4 Encounter Editor
- [ ] WebviewPanel with dynamic form (DynamicFormRenderer)
- [ ] Sections configurable via /api/tab-field-config/encounter-form

### 3.5 Appointments
- [ ] TreeView with today's appointments
- [ ] Create appointment command

## Phase 4-6: Deferred (Clinical, Admin, Native)
See EHR-UI-MIGRATION-GUIDE.md for full details.
