# EHR Patient Chart — Competitive Analysis

## Layout Patterns Across Major EHRs

| EHR | Layout | Navigation | Demographics | Content Area | Encounter View | Customization |
|-----|--------|-----------|-------------|-------------|---------------|---------------|
| **Epic Hyperspace** | 3-zone + right sidebar | Left Storyboard + Top Activity Tabs | Storyboard panel (photo, allergies, flags) | Central workspace | HPI, ROS, Exam, A/P as top tabs | Drag-reorder tabs, configurable storyboard width, widescreen mode |
| **Cerner / Oracle Health** | Banner + left nav + grid | Left Menu Navigator (pin/hide) | Top colored banner (name, age, allergies) — hyperlinks to popups | Spreadsheet/grid format | Click section headers for drill-down | MPages custom dashboards, configurable grid columns |
| **athenahealth** | Left tabs + central | Left Tab Menu | Embedded in encounter header | Linear encounter workspace | HPI → ROS → Exam → A/P linear flow | Specialty-tailored views, text macros, embedded AI chat |
| **DrChrono** | Header + left sidebar + central | Left Sidebar (+/- add, drag-reorder, eye show/hide) | Customizable top banner | Widget-based sections | Template-based charting | Full sidebar customization, mobile-first (iPad) |
| **OpenEMR** | Left nav + widget dashboard | 3 schemes: flat list, tree view, radio buttons | Top summary area (name, DOB, insurance) | Widget panels with edit pencil icons | Encounter forms in central area | Admin globals, code-level layout modification |

## Common Patterns (All 5 Systems)

| Pattern | Epic | Cerner | athena | DrChrono | OpenEMR |
|---------|------|--------|--------|----------|---------|
| Sticky demographics header at top | ✓ | ✓ | ✓ | ✓ | ✓ |
| Left-side navigation | ✓ | ✓ | ✓ | ✓ | ✓ |
| Central content as primary workspace | ✓ | ✓ | ✓ | ✓ | ✓ |
| Right sidebar for quick actions | ✓ | | | ✓ | |
| Horizontal activity tabs | ✓ | ✓ | | | |
| Widget/card-based data display | | ✓ | | ✓ | ✓ |
| Customizable sidebar sections | ✓ | | | ✓ | ✓ |
| Encounter linear workflow | ✓ | | ✓ | | |
| Summary/dashboard as landing page | ✓ | ✓ | ✓ | ✓ | ✓ |

## Ciyex Workspace Approach

| EHR Pattern | Ciyex Implementation |
|------------|---------------------|
| Left navigation | TOC sidebar with category headers + scroll sync |
| Demographics header | Sticky patient banner (name, DOB, MRN, gender, status) |
| Central content | Single scrollable page, max-width 1000px |
| Section headers | VS Code settings group headers (16px bold + line) |
| Field display | VS Code settings item pattern (label → value, read-only) |
| Edit mode | Click "Edit ✎" per section → inline form with Save/Cancel |
| Encounter view | Click → opens in right split editor (SIDE_GROUP) |
| Search/filter | Search bar in TOC filters all sections |
| Lazy loading | IntersectionObserver loads data on scroll |
| Config-driven | chart-layout.json + fields/*.json — no code changes to customize |

## Key Differentiators vs Competitors

| Differentiator | Detail |
|---------------|--------|
| Config-driven layout | chart-layout.json + fields/*.json define entire chart — customizable without code changes |
| VS Code native | Editor tabs, split views, command palette, keyboard shortcuts |
| FHIR-first | All data from `/api/fhir-resource/*` endpoints |
| Dark theme | Matches VS Code Default Dark Modern theme |
| Keyboard-friendly | F1 commands, search filter, keyboard navigation |
| Split detail view | Encounter/appointment detail opens in right editor group |
