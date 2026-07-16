/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { createCustomDropdown, findWorkbenchRoot } from '../customDropdown.js';
import { enablePickerClick, maskUsDate, usToIsoDate } from '../ciyexDateMask.js';
import { parseSavedRecord } from '../sidebarActions.js';

/**
 * Resolve a {@link FormFieldDef.minDate} token/string to a concrete ISO date
 * (yyyy-mm-dd). `'today'` → the current date; `'year-start'` → Jan 1 of the
 * current year (so any prior-year date is out of range); any other value is
 * treated as a literal ISO date.
 */
export function resolveMinDate(min: string): string {
	if (min === 'today') { return new Date().toISOString().slice(0, 10); }
	if (min === 'year-start') { return `${new Date().getFullYear()}-01-01`; }
	return min;
}

/**
 * Resolve a {@link FormFieldDef.maxDate} token/string to a concrete ISO date
 * (yyyy-mm-dd). `'today'` → the current date (rejects any future date, e.g. a
 * medication Date Issued dated tomorrow); `'year-end'` → Dec 31 of the current
 * year (rejects any future-year date); any other value is a literal ISO date.
 */
export function resolveMaxDate(max: string): string {
	if (max === 'today') { return new Date().toISOString().slice(0, 10); }
	if (max === 'year-end') { return `${new Date().getFullYear()}-12-31`; }
	return max;
}

interface ColumnDef { key: string; label: string; width?: string; aliases?: string[]; onClick?: (item: Record<string, unknown>, api: ICiyexApiService, reload: () => void, dlg: IDialogService) => void; emptyLabel?: string }
interface StatusTab { label: string; value: string }
interface ActionDef {
	label: string;
	icon: string;
	handler: (item: Record<string, unknown>, api: ICiyexApiService, reload: () => void, dlg: IDialogService) => void;
	/**
	 * Optional per-row predicate. When provided and it returns false, the
	 * action button is not rendered for that row. Use to show only the
	 * applicable status transition (e.g. Referrals only offers the next valid
	 * step) instead of every action on every row.
	 */
	visible?: (item: Record<string, unknown>) => boolean;
	/**
	 * Optional icon colour. Monochrome glyph icons (check / cross) inherit the
	 * foreground colour, which on some themes is too low-contrast to spot in
	 * the actions column (QA issue 17: approve/deny "not visible" on dark).
	 * Set an explicit colour so the action always stands out.
	 */
	color?: string;
}

export interface FormFieldDef {
	key: string;
	label: string;
	type: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'search';
	required?: boolean;
	placeholder?: string;
	options?: Array<{ label: string; value: string }>;
	/** For 'select' type: load the dropdown options from this API endpoint
	 * (e.g. /api/inventory/categories). Response may be an array or
	 * { data: { content: [...] } }. Each item is mapped via
	 * {@link optionsLabelField} (default 'name') and {@link optionsValueField}
	 * (default 'id'). Lets a select behave like the ehr-ui native dropdowns. */
	optionsApiPath?: string;
	/** For a 'select' type: render the (static {@link options}) as a row of
	 *  always-visible pill buttons inside a bordered box instead of a dropdown —
	 *  used for short status/state fields where seeing every choice at a glance is
	 *  clearer than opening a popover. */
	segmented?: boolean;
	/** For 'select' with {@link optionsApiPath}: item field to show. Default 'name'. */
	optionsLabelField?: string;
	/** For 'select' with {@link optionsApiPath}: item field used as the value. Default 'id'. */
	optionsValueField?: string;
	/** For 'search' type: API path to search. Expects { data: { content: [...] } } or array */
	searchApiPath?: string;
	/** For 'search' type: which field to display from results */
	searchDisplayField?: string;
	/** For 'search' type: which field to use as value */
	searchValueField?: string;
	/** For 'search' type: API endpoint path for live search (appends ?search=) */
	apiPath?: string;
	/** For 'search' type: field key to auto-fill when a result is selected (e.g. patientId) */
	relatedField?: string;
	/** For 'search' type: fields from API response to display in dropdown */
	relatedDisplayFields?: string[];
	/**
	 * For 'search' type: result field whose value is placed into THIS search input
	 * on selection (e.g. only the description), independent of the dropdown text
	 * built from {@link relatedDisplayFields}. Used so a code search can show
	 * "code description" in the dropdown but put only the description in the
	 * Procedure/Diagnosis text box while the code goes into {@link relatedField}.
	 */
	selectDisplayField?: string;
	/** For 'search' type: query parameter name for live search. Defaults to 'search'.
	 * ciyex-codes uses 'q', most other backends use 'search'. */
	searchParam?: string;
	/** For 'search' type: regex pattern of acceptable input values (e.g. for negative-case validation). */
	pattern?: string;
	/**
	 * For 'search' type: only accept a value chosen from the results dropdown.
	 * Free-typed text that isn't selected is cleared on blur (so it can't be
	 * saved), and once a result is picked the input becomes read-only until the
	 * user clears it with the clear button. Use for fields that must reference a real
	 * record (e.g. a provider), not arbitrary text.
	 */
	strictSelect?: boolean;
	/** Validation pattern for non-search inputs (regex source). When set, save fails if value doesn't match. */
	validationPattern?: string;
	/** Error message for validationPattern mismatch. */
	validationMessage?: string;
	/** For text/number inputs: cap the field to this many digits, stripping any
	 *  extra digit as the user types (e.g. fax number <= 12 digits). */
	maxDigits?: number;
	/**
	 * For 'search' type: client-side fallback options used when the API returns empty/fails.
	 * Items are filtered against the typed query (substring match against displayField/value).
	 * Useful for code systems (CVX, etc.) when the backend dataset is incomplete.
	 */
	fallbackOptions?: Array<Record<string, string>>;
	/**
	 * For 'search' type: when the primary search returns nothing, also offer the
	 * selected patient's EXISTING insurance names (from the form's `patientId`
	 * companion field via the insurance-coverage endpoint). Used by the Prior
	 * Auth Insurance Name search: the patient's snapshot insurance must be
	 * findable even when the org's insurance-companies catalog is empty.
	 */
	patientCoverageFallback?: boolean;
	/**
	 * For 'search' type: map of additional form-field keys to fill from a selected result.
	 * Key is the form field to fill, value is the property key on the result object.
	 * Example: { patientLastName: 'lastName', patientPhone: 'phone' }
	 */
	relatedFieldsMap?: Record<string, string>;
	/**
	 * When populating an edit form, if `key` is missing/empty on the record, try these
	 * alternate keys in order. Supports dot paths for nested objects (e.g. `category.id`).
	 */
	aliases?: string[];
	/** Default value for new records (or a factory function for dynamic values like timestamps). */
	defaultValue?: string | number | (() => string | number);
	/** Width hint */
	width?: string;
	/** Minimum allowed numeric value. Maps to HTML `min` attribute and is enforced on save. */
	minValue?: number;
	/** Maximum allowed numeric value. Maps to HTML `max` attribute and is enforced on save. */
	maxValue?: number;
	/**
	 * For 'date' fields: the earliest date the field accepts. Accepts an ISO
	 * date string, or the tokens `'today'` (resolves to the current date) and
	 * `'year-start'` (resolves to Jan 1 of the current year — rejects any
	 * past-year date). Enforced on save and mapped to the picker's `min`
	 * attribute so the calendar can't pick an out-of-range date.
	 */
	minDate?: 'today' | 'year-start' | string;
	/**
	 * For 'date' fields: the latest date the field accepts. Accepts an ISO date
	 * string, or the tokens `'today'` (current date — rejects any future date)
	 * and `'year-end'` (Dec 31 of the current year — rejects any future-year
	 * date). Enforced on save and mapped to the picker's `max` attribute so the
	 * calendar can't pick an out-of-range date.
	 */
	maxDate?: 'today' | 'year-end' | string;
	/** Render the field off-screen. Used for fields that should only be filled via auto-fill
	 * from a related `search`-type field (e.g. patientId, materialId). */
	hidden?: boolean;
	/** Regex (as string) that each individual typed character must match.
	 * When set, keydown/paste/input guards enforce this at input time so
	 * invalid characters never land in the field. */
	typingPattern?: string;
	/**
	 * Render the field as read-only: the value is shown (and can still be
	 * populated programmatically via auto-fill from a related `search` field),
	 * but the user cannot type into or change it. Used for fields that mirror an
	 * authoritative source — e.g. a recall's Phone/Email which must match the
	 * selected patient's record and should never be hand-edited.
	 */
	readOnly?: boolean;
}

export interface FilterDropdownDef {
	/** Field key to filter on (must exist on list items) */
	key: string;
	/** Placeholder shown as the "All" option */
	placeholder: string;
	options: Array<{ label: string; value: string }>;
	/**
	 * Optional async loader for the option list. When set, options are fetched
	 * at render time and appended after any static {@link options}. Use for
	 * filters that must reflect live data (e.g. the Patient Recall provider
	 * filter, which must list the current practice's providers — not a stale
	 * hardcoded set).
	 */
	optionsLoader?: () => Promise<Array<{ label: string; value: string }>>;
	/**
	 * Optional custom matcher. When set, an item passes this filter only if
	 * `match(item, selectedValue)` returns true, instead of the default
	 * exact field-value comparison. Use for synthetic filters whose value
	 * doesn't map to a single item field — e.g. a due-date range, or a
	 * provider filter whose option label is a fuller name than the item's
	 * stored display name.
	 */
	match?: (item: Record<string, unknown>, value: string) => boolean;
}


export interface ClinicalEditorConfig {
	title: string;
	apiPath: string;
	statsPath?: string;
	columns: ColumnDef[];
	statusTabs?: StatusTab[];
	actions?: ActionDef[];
	searchPlaceholder?: string;
	/** Form fields for create/edit dialog. If not set, no create/edit button is shown. */
	formFields?: FormFieldDef[];
	/**
	 * Alternate edit-form schema for rows merged in from a foreign store (marked
	 * `__readonly` by enrichItems). When set, those rows become editable through
	 * this schema instead of the main `formFields` — e.g. the CDS module merges
	 * patient-chart FHIR Flag alerts and edits them with Flag-shaped fields
	 * (alertName/severity/notes) while CDS rules keep the rule schema. Pair with a
	 * `buildItemUrl`/`beforeSave` that branch on `item['__readonly']` to target the
	 * foreign store's endpoint and payload shape.
	 */
	readonlyEditFields?: FormFieldDef[];
	/** Label for the create button. Default: "+ New" */
	createLabel?: string;
	/**
	 * Whether new records can be created via this editor (shows the "+ New" button).
	 * Defaults to `true` when formFields is set. Use `false` for editors that share
	 * a form schema with edit but where the backend doesn't support direct creation
	 * (e.g. claims, which are derived from invoices/encounters).
	 */
	creatable?: boolean;
	/** Whether editing existing items is supported */
	editable?: boolean;
	/** Custom render for a cell value */
	cellRenderer?: (key: string, value: unknown, item: Record<string, unknown>) => string;
	/**
	 * Optional async post-load hook to enrich loaded rows before they are
	 * rendered (e.g. resolve a patientId to a patient name). Mutate the passed
	 * items in place or return a replacement array. Failures are ignored.
	 */
	enrichItems?: (items: Record<string, unknown>[]) => Promise<Record<string, unknown>[] | void>;
	/** Priority filter options */
	priorityOptions?: Array<{ label: string; value: string }>;
	/** Extra dropdown filters shown in the toolbar alongside Search. Client-side only. */
	additionalFilters?: FilterDropdownDef[];
	/** Key used for status tab filtering. Defaults to 'status'. E.g. audit logs use 'action'. */
	filterKey?: string;
	/**
	 * When set, the editor loads all records in one call and filters client-side
	 * against these fields. Use for small datasets where the backend doesn't
	 * support `q=` / status params. Status tabs still filter on `filterKey` (default: status).
	 */
	clientSideFilter?: string[];
	/**
	 * When true, the edit save payload is the merge of the original record and
	 * the form values (instead of only the form values). Also strips nested
	 * objects whose `id` is null to avoid backend "id cannot be null" errors.
	 * Needed when the backend requires a complete record on PUT.
	 */
	mergeOnEdit?: boolean;
	/** Custom dialog title for edit. Default: `Edit ${title without trailing s}`. */
	editTitle?: (item: Record<string, unknown>) => string;
	/**
	 * When true, on Edit click the editor refetches `${apiPath}/${id}` and merges the
	 * response onto the row before opening the form. Use when list responses are
	 * partial (missing relational fields like provider name, code system, etc).
	 */
	refetchOnEdit?: boolean;
	/**
	 * Extra default values applied to every create payload (POST). Useful when the
	 * backend requires fields not surfaced in the form (e.g. CDS `appliesTo: 'all'`).
	 */
	createDefaults?: Record<string, unknown>;
	/**
	 * Optional payload transformer: rewrites the request body before save.
	 * Receives the merged form values and returns the final payload. On edits,
	 * `original` is the record being edited (null on create) so transforms can
	 * react to state TRANSITIONS (e.g. stamp completedDate when a recall first
	 * turns COMPLETED).
	 */
	beforeSave?: (payload: Record<string, unknown>, isEdit: boolean, original?: Record<string, unknown> | null) => Record<string, unknown>;
	/**
	 * Called after a successful create/update with the saved record (the parsed
	 * server response merged over the submitted payload, always carrying `id`).
	 * Use for client-side bookkeeping the backend can't persist itself — e.g.
	 * Medical Codes Active/Inactive, which the `global_codes` PUT endpoint ignores,
	 * so the editor remembers the choice locally and re-applies it via {@link enrichItems}.
	 */
	afterSave?: (saved: Record<string, unknown>, isEdit: boolean) => void;
	/**
	 * Cross-field date-order guard: when both date fields carry a value, the end
	 * date must not be earlier than the start date. Use for forms with a start/end
	 * date pair (e.g. Care Plans) so an end-before-start record can never be saved.
	 */
	endNotBeforeStart?: { startKey: string; endKey: string; message?: string };
	/**
	 * Optional async transformer applied to the record before the EDIT form is
	 * seeded. Use to backfill fields the row/GET-by-id doesn't carry — e.g. the
	 * lab-result DTO only has `patientId`, so this fetches the patient and adds
	 * `patientFirstName`/`patientLastName` so the patient name shows on edit.
	 */
	transformEditItem?: (item: Record<string, unknown>, api: ICiyexApiService) => Promise<Record<string, unknown>>;
	/**
	 * URL builder for GET-by-id (refetch on edit) and PUT (update). Use when the
	 * backend isn't a flat REST resource (e.g. patient-scoped /api/lab-order/{patientId}/{orderId}).
	 * Defaults to `${apiPath}/${item.id}`.
	 */
	buildItemUrl?: (item: Record<string, unknown>) => string;
	/**
	 * URL builder for POST (create). Same use-case as buildItemUrl.
	 * Defaults to `apiPath`.
	 */
	buildCreateUrl?: (payload: Record<string, unknown>) => string;
	/**
	 * Maps stats-card keys to status-filter values. Keys present in the map are
	 * clickable filters; keys NOT in the map render as info-only (e.g. aggregates
	 * like totals/sums). When unset, every stats key is clickable and uses the
	 * raw key as its filter (legacy behavior — works only if stats keys match
	 * status values directly).
	 */
	statsFilterMap?: Record<string, string>;
	/**
	 * Custom matchers for specific status-filter values, keyed by the filter value
	 * (e.g. `OVERDUE`). When the active status filter has an entry here, rows are
	 * matched with this predicate instead of an exact `status` compare. Needed when
	 * a stats card / status tab is a *computed* status (Recall's Overdue counts
	 * every past-due, non-completed recall server-side, so a literal
	 * `status === 'OVERDUE'` compare hides the rows behind the count).
	 */
	statusMatchers?: Record<string, (item: Record<string, unknown>) => boolean>;
	/**
	 * Client-side stats derivation: computes the summary-card values from the
	 * loaded rows (after {@link enrichItems}), so the cards always agree with
	 * what the list/filters actually show. Receives the loaded items and the
	 * server stats (from {@link statsPath}, or `{}` when unset) and returns the
	 * stats to render. Fixes count/filter mismatches where the server counts a
	 * different population than the client-side filters display (Recall Overdue /
	 * Completed This Month, Prescriptions status cards, CDS rule cards).
	 */
	computeStats?: (items: Record<string, unknown>[], serverStats: Record<string, number>) => Record<string, number>;
	/**
	 * When true, the toolbar renders the status filter as a dropdown (using
	 * `statusTabs` as the option list) instead of as a row of pill buttons.
	 * Matches the web app's Labs page where Status / Priority / Result are
	 * shown as inline `<select>` controls.
	 */
	statusAsDropdown?: boolean;
	/**
	 * When true, KPI / stats cards render in a compact mode (~half the normal
	 * vertical height, smaller fonts). Used on dense KPI strips like the
	 * Patient Recall board where 7+ cards would otherwise dominate the page.
	 */
	compactStats?: boolean;
	/**
	 * When set, applied as `min-width` on the table grid so the outer wrapper
	 * can scroll horizontally instead of crushing columns. Use for pages with
	 * many columns plus an Actions column that must stay visible (e.g. the
	 * Patient Education Library — issue #24).
	 */
	tableMinWidth?: string;
	/**
	 * Hook for rendering custom DOM (e.g. dynamic Goals / Interventions lists
	 * on Care Plans — issue #23) inside the dialog body. The hook is called
	 * once per dialog open and should return a `collect()` callback that
	 * produces extra fields for the save payload.
	 */
	formExtras?: (container: HTMLElement, editingItem: Record<string, unknown> | null) => FormExtrasHandle;
	/**
	 * Optional override for the list GET URL. Use for views whose backend
	 * endpoint is patient-scoped (e.g. /api/payments/plans/patient/{id}) and has
	 * no global list route. Return `null` when no context is selected yet — the
	 * editor then renders {@link emptyListMessage} instead of firing a request
	 * that would 404/405.
	 */
	listUrlBuilder?: () => string | null;
	/** Message shown when {@link listUrlBuilder} returns null (no selection yet). */
	emptyListMessage?: string;
}

export interface FormExtrasHandle {
	/** Called at save time to merge dynamic-list data into the payload. */
	collect: () => Record<string, unknown>;
}

const STATUS_COLORS: Record<string, string> = {
	active: '#22c55e', completed: '#6b7280', cancelled: '#ef4444', 'on-hold': '#f59e0b', 'on_hold': '#f59e0b',
	discontinued: '#ef4444', pending: '#f59e0b', approved: '#22c55e', denied: '#ef4444',
	draft: '#6b7280', sent: '#3b82f6', scheduled: '#8b5cf6', expired: '#6b7280',
	routine: '#3b82f6', urgent: '#f59e0b', stat: '#ef4444',
	info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444',
	overdue: '#ef4444', notified: '#3b82f6',
	low: '#22c55e', normal: '#3b82f6', high: '#f59e0b',
	submitted: '#3b82f6', appeal: '#8b5cf6',
	// Inventory
	in_stock: '#22c55e', low_stock: '#f59e0b', out_of_stock: '#ef4444',
	// Payments
	processing: '#3b82f6', failed: '#ef4444', refunded: '#8b5cf6', voided: '#6b7280',
	partial_refund: '#8b5cf6',
	// Lab
	final: '#22c55e', preliminary: '#f59e0b', corrected: '#3b82f6',
	// Education
	'in-progress': '#3b82f6', preparation: '#f59e0b', 'not-done': '#6b7280',
};

/** A labelled field rendered inside {@link showThemedModal}. */
interface IThemedModalField {
	key: string;
	label: string;
	type?: 'text' | 'number' | 'date' | 'textarea';
	value?: string;
	placeholder?: string;
	/** When true, the confirm button is blocked until this field has a value. */
	required?: boolean;
	/** For 'textarea' type: number of visible rows (taller reason boxes). Default 4. */
	rows?: number;
}

interface IThemedModalOptions {
	title: string;
	/** Optional sub-heading line rendered under the title (e.g. patient + procedure). */
	subtitle?: string;
	fields: IThemedModalField[];
	confirmLabel: string;
	/** Accent colour for the confirm button (e.g. green for Approve). */
	confirmColor?: string;
	/** Optional DOM anchor used to locate the workbench root for theming.
	 * Defaults to the document body (findWorkbenchRoot then queries by class). */
	anchor?: HTMLElement;
}

/**
 * Render a small themed centre-screen modal with labelled fields and a
 * Cancel/confirm button pair, mounted inside `.monaco-workbench` so the VS
 * Code CSS variables resolve to the active light/dark theme. Resolves to a map
 * of field key -> entered value, or `null` when cancelled. Used for the
 * Authorization "Approve Authorization" popup (issue #17a) so it matches the
 * multi-field web-app modal instead of the bare single-input dialog prompt.
 */
export function showThemedModal(opts: IThemedModalOptions): Promise<Record<string, string> | null> {
	return new Promise<Record<string, string> | null>(resolve => {
		const doc = mainWindow.document;
		const mount = findWorkbenchRoot(opts.anchor || doc.body || doc.documentElement, doc);
		const overlay = DOM.append(mount, DOM.$('div'));
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		// `background:transparent` is REQUIRED: copying the workbench className above
		// also copies `.monaco-workbench`'s opaque editor background, which would
		// paint the whole screen solid dark and hide the page behind the popup
		// (issues #11/#12: "popup background black — make it a transparent overlay").
		// The semi-transparent backdrop child below provides the only dimming.
		overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;color:var(--vscode-foreground);background:transparent;';

		// Light scrim so the page stays visible behind the popup (issues #11/#12:
		// the Approve/Deny popup must be a transparent overlay, not a black screen).
		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.12);';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'position:relative;width:420px;max-width:92vw;max-height:90vh;overflow-y:auto;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,0.4);padding:20px;box-sizing:border-box;';

		const titleEl = DOM.append(modal, DOM.$('h3'));
		titleEl.textContent = opts.title;
		titleEl.style.cssText = 'margin:0 0 8px;font-size:16px;font-weight:600;';

		if (opts.subtitle) {
			const sub = DOM.append(modal, DOM.$('p'));
			sub.textContent = opts.subtitle;
			sub.style.cssText = 'margin:0 0 16px;font-size:12px;color:var(--vscode-descriptionForeground);';
		}

		const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		const inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
		for (const f of opts.fields) {
			const grp = DOM.append(modal, DOM.$('div'));
			grp.style.cssText = 'margin-bottom:12px;';
			const lbl = DOM.append(grp, DOM.$('label'));
			lbl.textContent = f.label + (f.required ? ' *' : '');
			lbl.style.cssText = 'display:block;font-size:11px;margin-bottom:4px;color:var(--vscode-descriptionForeground);';
			if (f.type === 'textarea') {
				const ta = DOM.append(grp, DOM.$('textarea')) as HTMLTextAreaElement;
				ta.value = f.value ?? '';
				ta.placeholder = f.placeholder ?? '';
				ta.rows = f.rows ?? 4;
				ta.style.cssText = inputStyle + 'resize:vertical;min-height:90px;line-height:1.5;';
				inputs.set(f.key, ta);
			} else {
				const input = DOM.append(grp, DOM.$('input')) as HTMLInputElement;
				input.type = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text';
				input.value = f.value ?? '';
				input.placeholder = f.placeholder ?? '';
				input.style.cssText = inputStyle + (f.type === 'date' ? 'color-scheme:dark light;' : '');
				inputs.set(f.key, input);
			}
		}

		const footer = DOM.append(modal, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:8px;';

		let settled = false;
		const close = (result: Record<string, string> | null) => {
			if (settled) { return; }
			settled = true;
			overlay.remove();
			resolve(result);
		};

		const cancelBtn = DOM.append(footer, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-secondaryBackground,transparent);color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;cursor:pointer;font-size:12px;';
		cancelBtn.addEventListener('click', () => close(null));

		const confirmBtn = DOM.append(footer, DOM.$('button'));
		confirmBtn.textContent = opts.confirmLabel;
		confirmBtn.style.cssText = `padding:6px 14px;background:${opts.confirmColor || 'var(--vscode-button-background)'};color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;`;
		confirmBtn.addEventListener('click', () => {
			// Enforce required fields — block the confirm and flag the empty field
			// instead of silently submitting (e.g. discontinuation Reason is mandatory).
			for (const f of opts.fields) {
				if (!f.required) { continue; }
				const el = inputs.get(f.key);
				if (el && !el.value.trim()) {
					el.style.borderColor = 'var(--vscode-inputValidation-errorBorder,#be1100)';
					el.focus();
					return;
				}
			}
			const out: Record<string, string> = {};
			for (const [k, el] of inputs.entries()) { out[k] = el.value.trim(); }
			close(out);
		});

		backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { close(null); } });
		overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { close(null); } });

		const first = opts.fields.length > 0 ? inputs.get(opts.fields[0].key) : undefined;
		(first || confirmBtn).focus();
	});
}

/** A single label/value row in {@link showThemedDetails}. */
export interface IThemedDetailRow {
	label: string;
	value: string;
	/** Optional accent colour — renders the value as a coloured pill (e.g. status). */
	accent?: string;
	/** Render the value larger/bolder (e.g. an amount). */
	emphasis?: boolean;
	/** Span the full width on its own row (e.g. a long description). */
	wide?: boolean;
}

interface IThemedDetailsOptions {
	title: string;
	subtitle?: string;
	rows: IThemedDetailRow[];
	/** Footer button label. Defaults to 'Close'. */
	closeLabel?: string;
	anchor?: HTMLElement;
}

/**
 * Read-only counterpart to {@link showThemedModal}: a themed centre-screen card
 * that lays out label/value rows in a two-column grid with a single Close
 * button. Used for "View" row actions (e.g. a payment transaction) so they get
 * a proper themed detail card instead of the bare native info dialog.
 */
export function showThemedDetails(opts: IThemedDetailsOptions): Promise<void> {
	return new Promise<void>(resolve => {
		const doc = mainWindow.document;
		const mount = findWorkbenchRoot(opts.anchor || doc.body || doc.documentElement, doc);
		const overlay = DOM.append(mount, DOM.$('div'));
		overlay.className = mount.classList.contains('monaco-workbench') ? mount.className : 'monaco-workbench';
		overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;color:var(--vscode-foreground);background:transparent;';

		const backdrop = DOM.append(overlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.12);';

		const modal = DOM.append(overlay, DOM.$('div'));
		modal.style.cssText = 'position:relative;width:460px;max-width:92vw;max-height:90vh;overflow-y:auto;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));border:1px solid var(--vscode-editorWidget-border);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,0.4);box-sizing:border-box;';

		const header = DOM.append(modal, DOM.$('div'));
		header.style.cssText = 'padding:18px 20px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const titleEl = DOM.append(header, DOM.$('h3'));
		titleEl.textContent = opts.title;
		titleEl.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		if (opts.subtitle) {
			const sub = DOM.append(header, DOM.$('p'));
			sub.textContent = opts.subtitle;
			sub.style.cssText = 'margin:4px 0 0;font-size:12px;color:var(--vscode-descriptionForeground);';
		}

		const grid = DOM.append(modal, DOM.$('div'));
		grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;padding:18px 20px;';
		for (const row of opts.rows) {
			const cell = DOM.append(grid, DOM.$('div'));
			cell.style.cssText = `min-width:0;${row.wide ? 'grid-column:1 / -1;' : ''}`;
			const l = DOM.append(cell, DOM.$('div'));
			l.textContent = row.label;
			l.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);margin-bottom:3px;';
			if (row.accent) {
				const pill = DOM.append(cell, DOM.$('span'));
				pill.textContent = row.value;
				pill.style.cssText = `display:inline-flex;align-items:center;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;background:${row.accent}1f;color:${row.accent};border:1px solid ${row.accent}66;`;
			} else {
				const v = DOM.append(cell, DOM.$('div'));
				v.textContent = row.value;
				v.style.cssText = `color:var(--vscode-editor-foreground);${row.emphasis ? 'font-size:16px;font-weight:700;' : 'font-size:13px;font-weight:600;'}${row.wide ? 'white-space:pre-wrap;word-break:break-word;' : 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'}`;
			}
		}

		const footer = DOM.append(modal, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:0 20px 18px;';
		let settled = false;
		const close = (): void => { if (settled) { return; } settled = true; overlay.remove(); resolve(); };
		const closeBtn = DOM.append(footer, DOM.$('button'));
		closeBtn.textContent = opts.closeLabel || 'Close';
		closeBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground,#fff);border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		closeBtn.addEventListener('click', close);
		backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) { close(); } });
		overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); } });
		closeBtn.focus();
	});
}

/**
 * Base class for all clinical list editors.
 * Subclasses set `config` and the base renders everything:
 * stats cards, status tabs, search, table, pagination, create/edit form dialog.
 */
export abstract class ClinicalListEditorBase extends EditorPane {
	protected abstract readonly config: ClinicalEditorConfig;

	protected root!: HTMLElement;
	protected contentEl!: HTMLElement;
	private items: Record<string, unknown>[] = [];
	private stats: Record<string, number> = {};
	/** Raw stats as returned by {@link ClinicalEditorConfig.statsPath} — kept
	 * separate so a late-arriving server response can't clobber values already
	 * derived by {@link ClinicalEditorConfig.computeStats}. */
	private serverStats: Record<string, number> = {};
	private searchValue = '';
	private statusFilter = '';
	private priorityFilter = '';
	private currentPage = 0;
	private totalPages = 1;
	private clientPageSize = 20;
	private formOverlay: HTMLElement | null = null;
	/** Teardown callbacks for the open form's search fields (window scroll/resize
	 *  listeners that reposition the autocomplete dropdowns). Run whenever the form
	 *  overlay is torn down so the listeners don't outlive the form. */
	private formListenerCleanups: Array<() => void> = [];
	private editingItem: Record<string, unknown> | null = null;
	/** Initial values for a CREATE form (editingItem === null). Lets callers open a
	 *  pre-filled "New …" dialog — e.g. Education Library "Assign to Patient" seeds
	 *  the new-assignment form with the chosen material. Cleared when the form closes. */
	private formSeed: Record<string, unknown> | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private searchDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private refocusSearchAfterRender = false;
	private additionalFilterValues = new Map<string, string>();

	constructor(
		id: string,
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService protected readonly apiService: ICiyexApiService,
		@IDialogService protected readonly dialogService: IDialogService,
	) {
		super(id, group, telemetryService, themeService, storageService);
		// Reload when the SAME resource is mutated elsewhere (e.g. the Clinical
		// sidebar's "..." edit dialog): the sidebar save persisted, but this
		// open editor kept showing the pre-edit rows until a manual reload
		// (QA: prescription status edited in the sidebar never updated in the
		// open Prescriptions list). `this.config` is a subclass property, so
		// read it lazily inside the handler — events only fire after init.
		this._register(this.apiService.onDidMutateClinicalRecord(m => {
			const base = this.config?.apiPath?.split('?')[0].replace(/\/$/, '');
			if (base && m.entity === base && this.root) {
				void this._loadData();
			}
		}));
	}

	protected createEditor(parent: HTMLElement): void {
		// Subclasses can override `wrapContent` to inject decoration (e.g. a
		// sidebar). Default returns parent unchanged.
		const contentHost = this.wrapContent(parent);
		this.root = DOM.append(contentHost, DOM.$('.clinical-list-editor.ciyex-editor-root'));
		// Outer container hides scrollbars by default; the inner content scrolls only
		// when it actually overflows. Matches ciyex-ehr-ui where pages don't double-scroll.
		this.root.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;background:var(--vscode-editor-background);position:relative;';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;width:100%;padding:20px 24px;box-sizing:border-box;';
	}

	/**
	 * Hook for subclasses to wrap the editor in additional UI such as a left
	 * sidebar. The returned element becomes the parent of the standard content.
	 * Default implementation returns `parent` unchanged.
	 */
	protected wrapContent(parent: HTMLElement): HTMLElement {
		return parent;
	}

	/** Reload list data (and stats if configured). Exposed for subclasses that
	 * mutate state (e.g. sidebar view-switch) and need to trigger a refresh. */
	protected reload(): void {
		if (this.config.statsPath) { this._loadStats(); }
		this._loadData();
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (this.config.statsPath) { this._loadStats(); }
		this._loadData();
	}

	private async _loadStats(): Promise<void> {
		try {
			const res = await this.apiService.fetch(this.config.statsPath!);
			if (res.ok) {
				this.serverStats = ((await res.json())?.data || {}) as Record<string, number>;
				this._applyStats();
			}
		} catch { /* */ }
	}

	/** Refresh {@link stats} from the server values, letting the config derive
	 * client-side counts from the loaded rows when {@link ClinicalEditorConfig.computeStats}
	 * is set. Safe against load-order races: called from both the stats fetch and
	 * the data load, whichever finishes last wins with the same result. */
	private _applyStats(): void {
		try {
			this.stats = this.config.computeStats
				? this.config.computeStats(this.items, this.serverStats)
				: this.serverStats;
		} catch { this.stats = this.serverStats; }
	}

	private async _loadData(): Promise<void> {
		try {
			// Patient-scoped views (e.g. Payments → Plans / Ledger) supply their
			// own URL. A null result means nothing is selected yet — render a
			// friendly empty state instead of hitting a non-existent global route.
			if (this.config.listUrlBuilder) {
				const built = this.config.listUrlBuilder();
				if (!built) {
					this.items = [];
					this.totalPages = 1;
					this._applyStats();
					this._render();
					return;
				}
				const res = await this.apiService.fetch(built);
				if (!res.ok) {
					this.items = [];
					this.totalPages = 1;
					let detail = '';
					try {
						const errData = await res.json() as Record<string, unknown> | null;
						if (errData) { detail = String(errData['message'] || errData['error'] || ''); }
					} catch { /* non-JSON body */ }
					const base = `Failed to load data (HTTP ${res.status}).`;
					this._renderError(detail ? `${base} ${detail}` : `${base} The API endpoint may be unavailable.`);
					return;
				}
				const data = await res.json();
				const wrapper = data?.data ?? data;
				if (wrapper?.content) {
					this.items = wrapper.content as Record<string, unknown>[];
					this.totalPages = wrapper.totalPages || 1;
				} else if (Array.isArray(wrapper)) {
					this.items = wrapper;
					this.totalPages = 1;
				} else {
					this.items = [];
					this.totalPages = 1;
				}
				this._applyStats();
				this._render();
				return;
			}
			const clientFilter = this.config.clientSideFilter;
			let url: string;
			if (clientFilter) {
				// Client-side mode: load all in one page, skip server search/status params.
				url = `${this.config.apiPath}?page=0&size=500`;
			} else {
				url = `${this.config.apiPath}?page=${this.currentPage}&size=20`;
				if (this.searchValue) { url += `&q=${encodeURIComponent(this.searchValue)}`; }
				if (this.statusFilter) { const fk = this.config.filterKey || 'status'; url += `&${fk}=${this.statusFilter}`; }
				if (this.priorityFilter) { url += `&priority=${this.priorityFilter}`; }
			}
			const res = await this.apiService.fetch(url);
			if (!res.ok) {
				this.items = [];
				this.totalPages = 1;
				// Try to extract server-supplied error message so users see what really
				// failed (e.g. "Org alias not present" vs the generic HTTP 500 wrapper).
				let detail = '';
				try {
					const errData = await res.json() as Record<string, unknown> | null;
					if (errData) {
						detail = String(errData['message'] || errData['error'] || '');
					}
				} catch { /* non-JSON body */ }
				const base = `Failed to load data (HTTP ${res.status}).`;
				this._renderError(detail ? `${base} ${detail}` : `${base} The API endpoint may be unavailable.`);
				return;
			}
			const data = await res.json();
			const wrapper = data?.data || data;
			if (wrapper?.content) {
				this.items = wrapper.content as Record<string, unknown>[];
				this.totalPages = wrapper.totalPages || 1;
			} else if (Array.isArray(wrapper)) {
				this.items = wrapper;
				this.totalPages = 1;
			} else {
				this.items = [];
				this.totalPages = 1;
			}
			// Run even when the primary endpoint returned nothing — enrichers may
			// MERGE rows from a second store (e.g. patient chart alerts into the
			// CDS rules list), which must surface on an otherwise empty page.
			if (this.config.enrichItems) {
				try {
					const enriched = await this.config.enrichItems(this.items);
					if (Array.isArray(enriched)) { this.items = enriched; }
				} catch { /* enrichment is best-effort */ }
			}
			this._applyStats();
			this._render();
		} catch {
			this.items = [];
			this.totalPages = 1;
			this._renderError('Unable to load data. Please check your connection and try again.');
		}
	}

	/** Call from a subclass (e.g. after switching a view) to reset state and reload. */
	protected _resetAndReload(): void {
		this.currentPage = 0;
		this.statusFilter = '';
		this.searchValue = '';
		this.priorityFilter = '';
		this.additionalFilterValues.clear();
		// Drop the previous view's stats: multi-view editors (Payments) swap the
		// whole config on a view switch, and without this the Transactions cards
		// (Month Collection / Month Count / …) stayed rendered on the Payment
		// Plans and Ledger tabs where they mean nothing and filter nothing.
		this.stats = {};
		this.serverStats = {};
		if (this.config.statsPath) { this._loadStats(); }
		this._loadData();
	}

	private _renderError(message: string): void {
		DOM.clearNode(this.contentEl);

		const titleBar = DOM.append(this.contentEl, DOM.$('div'));
		titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';
		const h = DOM.append(titleBar, DOM.$('h2'));
		h.textContent = this.config.title;
		h.style.cssText = 'font-size:20px;font-weight:600;margin:0;';

		const errorBox = DOM.append(this.contentEl, DOM.$('div'));
		errorBox.style.cssText = 'padding:24px;text-align:center;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-top:12px;';

		// allow-any-unicode-next-line
		const iconEl = DOM.append(errorBox, DOM.$('div'));
		// allow-any-unicode-next-line
		iconEl.textContent = '⚠';
		iconEl.style.cssText = 'font-size:28px;margin-bottom:8px;';

		const msgEl = DOM.append(errorBox, DOM.$('div'));
		msgEl.textContent = message;
		msgEl.style.cssText = 'font-size:13px;color:var(--vscode-descriptionForeground);margin-bottom:12px;';

		const retryBtn = DOM.append(errorBox, DOM.$('button'));
		retryBtn.textContent = 'Retry';
		retryBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		retryBtn.addEventListener('click', () => this._loadData());
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);
		const cfg = this.config;

		// allow-any-unicode-next-line
		// ─── Title bar with create button ───
		const titleBar = DOM.append(this.contentEl, DOM.$('div'));
		titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;';

		const h = DOM.append(titleBar, DOM.$('h2'));
		h.textContent = cfg.title;
		h.style.cssText = 'font-size:20px;font-weight:600;margin:0;';

		if (cfg.formFields && cfg.formFields.length > 0 && cfg.creatable !== false) {
			const createBtn = DOM.append(titleBar, DOM.$('button'));
			createBtn.textContent = cfg.createLabel || `+ New ${cfg.title.replace(/s$/, '')}`;
			createBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
			createBtn.addEventListener('mouseenter', () => { createBtn.style.background = '#1177bb'; });
			createBtn.addEventListener('mouseleave', () => { createBtn.style.background = '#0e639c'; });
			createBtn.addEventListener('click', () => this._openForm(null));
		}

		// allow-any-unicode-next-line
		// ─── Stats cards ───
		// Grid layout gives every card an equal width — the previous flex/wrap layout
		// sized cards to their content, which the QA team flagged as misaligned cards
		// with inconsistent spacing on the Referrals page.
		let numericStats = Object.entries(this.stats).filter(([, v]) => typeof v === 'number');
		if (numericStats.length > 0) {
			const row = DOM.append(this.contentEl, DOM.$('div'));
			// compactStats halves the vertical footprint for pages like Recall that
			// surface 7+ KPI cards — otherwise the strip dominates the viewport.
			const compact = !!cfg.compactStats;
			// In compact mode, only show stats that map to a filter value (clickable
			// KPI cards). Info-only aggregates (totals, sums) are omitted to keep
			// the strip to a single row. Issue #22: authorization/referrals.
			if (compact && cfg.statsFilterMap) {
				const mapped = new Set(Object.keys(cfg.statsFilterMap));
				numericStats = numericStats.filter(([k]) => mapped.has(k));
			}
			const cols = Math.min(numericStats.length, compact ? 8 : 6);
			const gap = compact ? 6 : 8;
			const marginB = compact ? 8 : 12;
			row.style.cssText = `display:grid;grid-template-columns:repeat(${cols},minmax(0,1fr));gap:${gap}px;margin-bottom:${marginB}px;`;
			// Compact card sizes (issues #17, #22): halve vertical footprint with
			// padding 8px 16px and 12px body font so the strip doesn't dominate.
			const cardPad = compact ? '3px 8px' : '8px 16px';
			const cardMinH = compact ? '24px' : '0';
			const cardGap = compact ? 1 : 6;
			const numFs = compact ? 13 : 12;
			const lblFs = compact ? 9 : 12;
			for (const [k, v] of numericStats) {
				// If statsFilterMap is set, only mapped keys are clickable filters; the
				// rest are info-only aggregates (e.g. total counts, sums). Without a
				// map, fall back to the legacy behavior of using the raw key.
				const filterValue = cfg.statsFilterMap ? cfg.statsFilterMap[k] : k;
				const clickable = filterValue !== undefined;
				const c = DOM.append(row, DOM.$('div'));
				const isActive = clickable && this.statusFilter === filterValue;
				// Default layout uses an inline row (number + label side-by-side) to
				// halve the vertical footprint. compactStats keeps the column layout
				// for KPI-heavy pages where the label needs its own line.
				const cardDir = compact ? 'column' : 'row';
				c.style.cssText = `padding:${cardPad};border:1px solid ${isActive ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};border-radius:6px;text-align:center;cursor:${clickable ? 'pointer' : 'default'};background:${isActive ? 'rgba(0,122,204,0.12)' : 'transparent'};transition:background 0.15s,border-color 0.15s;${clickable ? '' : 'opacity:0.85;'};display:flex;flex-direction:${cardDir};align-items:center;justify-content:center;gap:${cardGap}px;min-height:${cardMinH};`;
				if (clickable) {
					c.addEventListener('mouseenter', () => { if (!isActive) { c.style.background = 'var(--vscode-list-hoverBackground)'; } });
					c.addEventListener('mouseleave', () => { if (!isActive) { c.style.background = ''; } });
					c.addEventListener('click', () => { this.statusFilter = this.statusFilter === filterValue ? '' : filterValue!; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
				}
				const numEl = DOM.append(c, DOM.$('span'));
				numEl.textContent = String(v);
				numEl.style.cssText = `font-size:${numFs}px;font-weight:700;color:${STATUS_COLORS[k.toLowerCase()] || 'var(--vscode-foreground)'};line-height:1;`;
				const l = DOM.append(c, DOM.$('span'));
				l.textContent = k.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
				l.style.cssText = `font-size:${lblFs}px;color:var(--vscode-descriptionForeground);text-transform:capitalize;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;line-height:1;`;
			}
		}

		// allow-any-unicode-next-line
		// ─── Status tabs ───
		// Even spacing and consistent padding so the "subtopic" pills align
		// uniformly. Previously the 4px gap and varying padding made them feel
		// crowded (Medical Codes QA report).
		// When `statusAsDropdown` is set, the status filter is rendered inside the
		// toolbar as a <select> instead of pills (mirrors the web app's Labs page).
		if (cfg.statusTabs && !cfg.statusAsDropdown) {
			const tabs = DOM.append(this.contentEl, DOM.$('div'));
			tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;align-items:center;';
			for (const t of [{ label: 'All', value: '' }, ...cfg.statusTabs]) {
				const b = DOM.append(tabs, DOM.$('button'));
				b.textContent = t.label;
				const a = this.statusFilter === t.value;
				b.style.cssText = `padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;border:1px solid ${a ? 'var(--vscode-focusBorder)' : 'var(--vscode-editorWidget-border)'};background:${a ? 'rgba(0,122,204,0.15)' : 'transparent'};color:var(--vscode-foreground);transition:all 0.15s;white-space:nowrap;`;
				b.addEventListener('mouseenter', () => { if (!a) { b.style.background = 'var(--vscode-list-hoverBackground)'; } });
				b.addEventListener('mouseleave', () => { if (!a) { b.style.background = 'transparent'; } });
				b.addEventListener('click', () => { this.statusFilter = t.value; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
			}
		}

		// allow-any-unicode-next-line
		// ─── Toolbar: Search + Priority filter ───
		const tb = DOM.append(this.contentEl, DOM.$('div'));
		tb.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;align-items:center;';

		const s = DOM.append(tb, DOM.$('input')) as HTMLInputElement;
		s.type = 'text';
		s.placeholder = cfg.searchPlaceholder || 'Search...';
		s.value = this.searchValue;
		s.style.cssText = 'flex:1;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
		s.addEventListener('input', () => {
			if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
			this.debounceTimer = setTimeout(() => {
				this.searchValue = s.value;
				this.currentPage = 0;
				// Client-side filter: just re-render the already-loaded items.
				// Server-side: re-query with ?q=...
				if (cfg.clientSideFilter) {
					this.refocusSearchAfterRender = true;
					this._render();
				} else {
					this._loadData();
				}
			}, 300);
		});
		if (this.refocusSearchAfterRender) {
			this.refocusSearchAfterRender = false;
			const caret = this.searchValue.length;
			setTimeout(() => { s.focus(); s.setSelectionRange(caret, caret); }, 0);
		}

		// Status dropdown — mirrors the web app's Labs page where Status sits
		// in the toolbar alongside Priority and Result.
		if (cfg.statusAsDropdown && cfg.statusTabs) {
			const sel = DOM.append(tb, DOM.$('select')) as HTMLSelectElement;
			sel.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;min-width:130px;';
			sel.title = 'Status';
			const allOpt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			allOpt.value = '';
			allOpt.textContent = 'All Status';
			for (const t of cfg.statusTabs) {
				const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				opt.value = t.value;
				opt.textContent = t.label;
				if (this.statusFilter === t.value) { opt.selected = true; }
			}
			sel.addEventListener('change', () => { this.statusFilter = sel.value; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
		}

		if (cfg.priorityOptions) {
			const sel = DOM.append(tb, DOM.$('select')) as HTMLSelectElement;
			sel.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;min-width:130px;';
			sel.title = 'Priority';
			const allOpt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
			allOpt.value = '';
			allOpt.textContent = 'All Priority';
			for (const p of cfg.priorityOptions) {
				const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				opt.value = p.value;
				opt.textContent = p.label;
				if (this.priorityFilter === p.value) { opt.selected = true; }
			}
			sel.addEventListener('change', () => { this.priorityFilter = sel.value; this.currentPage = 0; if (cfg.clientSideFilter) { this._render(); } else { this._loadData(); } });
		}

		// Additional dropdown filters (e.g. Type, Severity for CDS)
		if (cfg.additionalFilters) {
			for (const fd of cfg.additionalFilters) {
				const sel = DOM.append(tb, DOM.$('select')) as HTMLSelectElement;
				sel.style.cssText = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';
				const allOpt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
				allOpt.value = '';
				allOpt.textContent = fd.placeholder;
				const current = this.additionalFilterValues.get(fd.key) || '';
				const addOption = (o: { label: string; value: string }) => {
					const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
					opt.value = o.value;
					opt.textContent = o.label;
					if (current === o.value) { opt.selected = true; }
				};
				for (const o of fd.options) { addOption(o); }
				// Live options (e.g. providers for the recall filter) are loaded
				// async and appended once resolved, so the dropdown reflects the
				// current practice's data instead of a stale hardcoded list.
				if (fd.optionsLoader) {
					fd.optionsLoader().then(loaded => {
						const seen = new Set(fd.options.map(o => o.value));
						for (const o of loaded) {
							if (o.value && !seen.has(o.value)) { seen.add(o.value); addOption(o); }
						}
						if (current) { sel.value = current; }
					}).catch(() => { /* leave static options */ });
				}
				sel.addEventListener('change', () => {
					this.additionalFilterValues.set(fd.key, sel.value);
					this.currentPage = 0;
					this._render();
				});
			}
		}

		// allow-any-unicode-next-line
		// ─── Table ───
		// Outer wrapper handles horizontal scrolling (issue #24): when the column
		// set is wider than the viewport, the user can scroll sideways instead of
		// the Actions column being clipped. Vertical scroll lives on the outer
		// editor root.
		const tbl = DOM.append(this.contentEl, DOM.$('div'));
		tbl.className = 'cle-table-wrap';
		tbl.style.cssText = 'flex:1;min-height:0;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow-x:auto;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;';
		const tblStyle = DOM.append(tbl, DOM.$('style'));
		tblStyle.textContent = '.cle-table-wrap{scrollbar-width:none;-ms-overflow-style:none;}.cle-table-wrap::-webkit-scrollbar{display:none;width:0;height:0;}';
		// `minmax(0,1fr)` lets flexible columns shrink below their content width.
		// Without this, an overflowing cell on one row would expand its column and
		// shift the others, so the header and data rows no longer aligned
		// (Medical Codes QA report: "Alignment issues between subtopics").
		const colWidths = cfg.columns.map(c => c.width || 'minmax(0,1fr)').join(' ');
		// Fixed actions-column width so header and data rows align (each row is its own
		// grid; `auto` would size independently per row and shift columns left/right).
		const actionCount = (cfg.actions?.length || 0) + (cfg.editable && cfg.formFields ? 1 : 0);
		const cols = colWidths + (actionCount > 0 ? ` ${Math.max(80, actionCount * 26 + 8)}px` : '');
		// Minimum table width (issues #8 / #24). Without one, `minmax(0,1fr)` columns
		// collapse toward 0 on a narrow pane and clip their content, while fixed-px
		// columns stay — so resizing the app appeared to "hide" columns/data. Every
		// table now gets a sensible min-width: when the pane is narrower the wrapper
		// scrolls horizontally (all columns reachable); when wider the flexible
		// columns expand to fill. Configs may still override via `tableMinWidth`.
		const computeDefaultMinWidth = (): string => {
			let total = 0;
			for (const c of cfg.columns) {
				const w = c.width;
				const px = w ? /^(\d+)px$/.exec(w) : null;
				// Fixed-px columns keep their width; flexible (fr / minmax / unset)
				// columns get a readable minimum so they never collapse to nothing.
				total += px ? parseInt(px[1], 10) : 130;
			}
			if (actionCount > 0) { total += Math.max(80, actionCount * 26 + 8); }
			total += cfg.columns.length * 8; // inter-column gaps
			return `${total}px`;
		};
		const tableMinW = `min-width:${cfg.tableMinWidth || computeDefaultMinWidth()};`;

		// Header
		const hr = DOM.append(tbl, DOM.$('div'));
		hr.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:8px 14px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:var(--vscode-sideBar-background,var(--vscode-editor-background));text-transform:uppercase;letter-spacing:0.3px;position:sticky;top:0;z-index:2;${tableMinW}`;
		// Header cells must shrink exactly like the body cells. Body cells set
		// `overflow:hidden` which gives them an automatic min-size of 0 so the
		// `minmax(0,1fr)` tracks collapse evenly. Header spans without it keep
		// `min-width:auto` (= min-content), so a long label like "Specialist /
		// Specialty" widens its header track past the matching body track and the
		// columns no longer line up (issue #16). Apply the same overflow style.
		const headerCellStyle = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;';
		for (const c of cfg.columns) { const hc = DOM.append(hr, DOM.$('span')); hc.textContent = c.label; hc.style.cssText = headerCellStyle; }
		if (cfg.actions || cfg.editable) { const ac = DOM.append(hr, DOM.$('span')); ac.textContent = 'Actions'; ac.style.cssText = headerCellStyle; }

		const filteredItems = this._visibleItems();
		// Client-side pagination: slice the filtered set into pages so every editor
		// shows a consistent page-by-page experience even when clientSideFilter loads
		// the full list. Server-side editors (no clientSideFilter) already paginate
		// via _loadData, so this branch is skipped for them.
		const isClientPaginated = !!cfg.clientSideFilter;
		let pageItems: Record<string, unknown>[] = filteredItems;
		let clientTotalPages = 1;
		if (isClientPaginated) {
			clientTotalPages = Math.max(1, Math.ceil(filteredItems.length / this.clientPageSize));
			if (this.currentPage >= clientTotalPages) { this.currentPage = clientTotalPages - 1; }
			const start = this.currentPage * this.clientPageSize;
			pageItems = filteredItems.slice(start, start + this.clientPageSize);
		}
		const visibleItems = pageItems;

		if (visibleItems.length === 0) {
			const e = DOM.append(tbl, DOM.$('div'));
			e.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			// When a patient-scoped view has no selection yet, guide the user
			// instead of implying there are no records.
			const noSelection = !!this.config.listUrlBuilder && this.config.listUrlBuilder() === null;
			e.textContent = noSelection ? (this.config.emptyListMessage || 'Select a patient first.') : 'No records found';
			// Pagination still shown below for empty pages so the user can navigate back.
		}

		for (const item of visibleItems) {
			const r = DOM.append(tbl, DOM.$('div'));
			r.style.cssText = `display:grid;grid-template-columns:${cols};gap:8px;padding:6px 14px;align-items:center;border-bottom:1px solid rgba(128,128,128,0.08);font-size:12px;transition:background 0.1s;${tableMinW}`;
			r.addEventListener('mouseenter', () => { r.style.background = 'var(--vscode-list-hoverBackground)'; });
			r.addEventListener('mouseleave', () => { r.style.background = ''; });

			for (const c of cfg.columns) {
				const cell = DOM.append(r, DOM.$('span'));
				const rawVal = item[c.key];
				// Normalize raw booleans to human-readable text before rendering
				let displayVal: string;
				if (cfg.cellRenderer) {
					displayVal = cfg.cellRenderer(c.key, rawVal, item);
				} else if (typeof rawVal === 'boolean') {
					// isActive → Active/Inactive; other booleans → Yes/No
					const lk = c.key.toLowerCase();
					if (lk === 'isactive' || lk === 'active') {
						displayVal = rawVal ? 'Active' : 'Inactive';
					} else if (lk === 'enabled' || lk === 'available' || lk === 'published') {
						displayVal = rawVal ? 'Enabled' : 'Disabled';
					} else {
						displayVal = rawVal ? 'Yes' : 'No';
					}
				} else {
					displayVal = String(rawVal ?? '');
				}
				if (c.onClick) {
					const isEmpty = !rawVal || String(rawVal).trim() === '';
					const linkText = isEmpty ? (c.emptyLabel || '') : displayVal;
					cell.textContent = linkText;
					cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					if (linkText) {
						cell.style.cssText += 'color:#3b82f6;cursor:pointer;font-weight:500;';
						cell.addEventListener('click', (ev) => { ev.stopPropagation(); c.onClick!(item, this.apiService, () => { this._loadStats(); this._loadData(); }, this.dialogService); });
					}
				} else {
					cell.textContent = displayVal;
					cell.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
					const lowerKey = c.key.toLowerCase();
					const v = displayVal;
					if (lowerKey === 'status' || lowerKey === 'priority' || lowerKey === 'severity' || lowerKey === 'urgency') {
						const clr = STATUS_COLORS[v.toLowerCase().replace(/\s+/g, '_')] || '#6b7280';
						cell.style.cssText += `color:${clr};font-weight:500;text-transform:capitalize;`;
					}
				}
			}

			if (cfg.actions || cfg.editable) {
				const acts = DOM.append(r, DOM.$('div'));
				acts.style.cssText = 'display:flex;gap:2px;';

				// Rows merged from a foreign store (marked __readonly by enrichItems)
				// can't be edited through this editor's own form/PUT endpoint — but if
				// the config supplies `readonlyEditFields`, they get their own edit form
				// (routed to the foreign store via buildItemUrl/beforeSave).
				const rowEditFields = item['__readonly'] === true ? cfg.readonlyEditFields : cfg.formFields;
				if (cfg.editable && rowEditFields && rowEditFields.length > 0) {
					const editBtn = DOM.append(acts, DOM.$('button'));
					// allow-any-unicode-next-line
					editBtn.textContent = '✏️';
					editBtn.title = 'Edit';
					editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;padding:2px;';
					editBtn.addEventListener('click', (ev) => { ev.stopPropagation(); this._openForm(item); });
				}

				if (cfg.actions) {
					for (const a of cfg.actions) {
						if (a.visible && !a.visible(item)) { continue; }
						const btn = DOM.append(acts, DOM.$('button'));
						btn.textContent = a.icon;
						btn.title = a.label;
						btn.style.cssText = `background:none;border:none;cursor:pointer;font-size:13px;padding:2px;${a.color ? `color:${a.color};` : ''}`;
						btn.addEventListener('click', (ev) => { ev.stopPropagation(); a.handler(item, this.apiService, () => { this._loadStats(); this._loadData(); }, this.dialogService); });
					}
				}
			}
		}

		// allow-any-unicode-next-line
		// ─── Pagination ───
		const pg = DOM.append(this.contentEl, DOM.$('div'));
		pg.style.cssText = 'flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 4px 0;border-top:1px solid var(--vscode-editorWidget-border);margin-top:4px;';

		const recordsInfo = DOM.append(pg, DOM.$('span'));
		recordsInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);';

		const navWrap = DOM.append(pg, DOM.$('div'));
		navWrap.style.cssText = 'display:flex;gap:6px;align-items:center;';

		if (isClientPaginated) {
			const total = filteredItems.length;
			const start = total === 0 ? 0 : this.currentPage * this.clientPageSize + 1;
			const end = Math.min(total, (this.currentPage + 1) * this.clientPageSize);
			recordsInfo.textContent = `Showing ${start}-${end} of ${total} records`;

			const mkBtn = (label: string, disabled: boolean, onClick: () => void) => {
				const b = DOM.append(navWrap, DOM.$('button'));
				b.textContent = label;
				b.style.cssText = `padding:4px 10px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;font-size:12px;background:transparent;color:var(--vscode-foreground);cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '0.5' : '1'};`;
				if (!disabled) { b.addEventListener('click', onClick); }
			};
			mkBtn('Previous', this.currentPage <= 0, () => { this.currentPage--; this._render(); });
			const pageInfo = DOM.append(navWrap, DOM.$('span'));
			pageInfo.textContent = `Page ${this.currentPage + 1} of ${clientTotalPages}`;
			pageInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);padding:0 4px;';
			mkBtn('Next', this.currentPage >= clientTotalPages - 1, () => { this.currentPage++; this._render(); });
		} else {
			recordsInfo.textContent = `${this.items.length} record${this.items.length === 1 ? '' : 's'}`;

			const mkBtn = (label: string, disabled: boolean, onClick: () => void) => {
				const b = DOM.append(navWrap, DOM.$('button'));
				b.textContent = label;
				b.style.cssText = `padding:4px 10px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;font-size:12px;background:transparent;color:var(--vscode-foreground);cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? '0.5' : '1'};`;
				if (!disabled) { b.addEventListener('click', onClick); }
			};
			const noNext = this.items.length < 20 && (this.totalPages <= this.currentPage + 1);
			mkBtn('Previous', this.currentPage <= 0, () => { this.currentPage--; this._loadData(); });
			const pageInfo = DOM.append(navWrap, DOM.$('span'));
			pageInfo.textContent = `Page ${this.currentPage + 1}${this.totalPages > 1 ? ` of ${this.totalPages}` : ''}`;
			pageInfo.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);padding:0 4px;';
			mkBtn('Next', noNext, () => { this.currentPage++; this._loadData(); });
		}
	}

	// Apply search + status + priority filters in memory when clientSideFilter is set.
	// Status filters use the configured filterKey (default 'status') and fall back to
	// common alternate keys (state, paymentStatus, etc) so backend naming differences
	// don't silently produce an empty filtered view.
	private _visibleItems(): Record<string, unknown>[] {
		const cfg = this.config;
		if (!cfg.clientSideFilter) { return this.items; }
		const q = this.searchValue.trim().toLowerCase();
		const fk = cfg.filterKey || 'status';
		const fallbackKeys = ['state', 'paymentStatus', 'orderStatus', 'currentStatus'];
		const statusF = this.statusFilter.toLowerCase().replace(/[-_\s]/g, '');
		const priF = this.priorityFilter.toLowerCase().replace(/[-_\s]/g, '');
		const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[-_\s]/g, '');
		return this.items.filter(item => {
			if (statusF) {
				// A computed status (e.g. Recall's Overdue) can supply a predicate so
				// the filtered rows match the stats-card count instead of a literal
				// status compare that would hide most of them.
				const matcher = cfg.statusMatchers?.[this.statusFilter] ?? cfg.statusMatchers?.[this.statusFilter.toUpperCase()];
				if (matcher) {
					if (!matcher(item)) { return false; }
				} else {
					const candidates = [item[fk], ...fallbackKeys.map(k => item[k])];
					const match = candidates.some(c => norm(c) === statusF);
					if (!match) { return false; }
				}
			}
			if (priF && norm(item['priority']) !== priF) { return false; }
			// Additional dropdown filters (e.g. ruleType, severity)
			for (const [k, v] of this.additionalFilterValues.entries()) {
				if (!v) { continue; }
				// A filter may supply a custom matcher (e.g. a due-date range, or a
				// provider filter whose option label is fuller than the item's stored
				// name). Use it instead of the default exact comparison — without this,
				// synthetic filters like `dueDateRange` match no item field and
				// silently hide every row (QA: recall filters show no data).
				const def = cfg.additionalFilters?.find(f => f.key === k);
				if (def?.match) {
					if (!def.match(item, v)) { return false; }
					continue;
				}
				const nv = norm(v);
				// Check the primary key and common alias (ruleType ↔ type)
				const candidates = [item[k], k === 'ruleType' ? item['type'] : undefined, k === 'type' ? item['ruleType'] : undefined];
				if (!candidates.some(c => c !== undefined && norm(c) === nv)) { return false; }
			}
			if (q) {
				const hit = cfg.clientSideFilter!.some(field => String(item[field] ?? '').toLowerCase().includes(q));
				if (!hit) { return false; }
			}
			return true;
		});
	}

	// allow-any-unicode-next-line
	// ─── Form Dialog ───

	protected async _openForm(item: Record<string, unknown> | null): Promise<void> {
		if (!this.config.formFields && !this.config.readonlyEditFields) { return; }
		// Optionally refetch full record by ID so the edit form has all relational fields.
		if (item && this.config.refetchOnEdit && item.id !== undefined && item.id !== null) {
			try {
				const itemUrl = this.config.buildItemUrl ? this.config.buildItemUrl(item) : `${this.config.apiPath}/${item.id}`;
				const res = await this.apiService.fetch(itemUrl);
				if (res.ok) {
					const json = await res.json().catch(() => null);
					const full = (json && (json.data ?? json)) as Record<string, unknown> | null;
					if (full && typeof full === 'object') {
						item = { ...item, ...full };
					}
				}
			} catch { /* fall through with row data */ }
		}
		// Backfill fields the record doesn't carry (e.g. patient name from
		// patientId on lab results) before seeding the edit form.
		if (item && this.config.transformEditItem) {
			try { item = await this.config.transformEditItem(item, this.apiService); } catch { /* keep record as-is */ }
		}
		this.editingItem = item;
		this.formSeed = null;
		this._renderForm();
	}

	/** Open a pre-filled CREATE form. Saves as a new record (POST) while seeding the
	 *  given field values — used by Education Library "Assign to Patient". */
	protected _openCreateForm(seed: Record<string, unknown>): void {
		if (!this.config.formFields) { return; }
		this.editingItem = null;
		this.formSeed = seed;
		this._renderForm();
	}

	/** Resolve a (possibly dot-pathed) key against the editing record. */
	private _readFieldValue(field: FormFieldDef): unknown {
		const item = this.editingItem;
		if (!item) {
			// Create mode: fall back to any seeded initial values.
			const sv = this.formSeed ? this.formSeed[field.key] : undefined;
			return (sv !== undefined && sv !== null && sv !== '') ? sv : undefined;
		}
		const direct = (item as Record<string, unknown>)[field.key];
		if (direct !== undefined && direct !== null && direct !== '') { return direct; }
		if (!field.aliases) { return direct; }
		for (const alias of field.aliases) {
			const v = alias.includes('.')
				? alias.split('.').reduce<unknown>((acc, part) => {
					if (acc && typeof acc === 'object') { return (acc as Record<string, unknown>)[part]; }
					return undefined;
				}, item)
				: (item as Record<string, unknown>)[alias];
			if (v !== undefined && v !== null && v !== '') { return v; }
		}
		return direct;
	}

	private _renderForm(): void {
		if (this.formOverlay) {
			this._teardownFormListeners();
			this.formOverlay.remove();
			this.formOverlay = null;
		}

		const cfg = this.config;
		// Merged foreign-store rows (marked __readonly) edit through readonlyEditFields
		// when supplied; everything else uses the main formFields schema.
		const fields = (this.editingItem?.['__readonly'] === true && cfg.readonlyEditFields)
			? cfg.readonlyEditFields
			: cfg.formFields!;
		const isEdit = this.editingItem !== null;

		// Right-side slide-in form panel — matches the Tasks "+ New Task" pattern
		// so every create/edit dialog across the EHR uses the same shape.
		// Mount inside `.monaco-workbench` so workbench CSS variables
		// (--vscode-sideBar-background, --vscode-foreground, …) resolve to
		// the active theme. Body-mount used to fall back to the dark hex
		// defaults inline-styled below, producing a dark drawer on a light
		// workbench (QA-flagged on clinical / operations / system create
		// drawers).
		const overlayDoc = mainWindow.document;
		const overlayMount = findWorkbenchRoot(this.root, overlayDoc);
		this.formOverlay = DOM.append(overlayMount, DOM.$('div'));
		// Mirror the real workbench's classList onto the overlay so it
		// re-declares every workbench CSS variable on itself — keeps the
		// drawer's children themed even if the mount root above falls back
		// to body.
		if (overlayMount.classList.contains('monaco-workbench')) {
			this.formOverlay.className = overlayMount.className;
		} else {
			this.formOverlay.className = 'monaco-workbench';
		}
		// Tag the drawer with the shared overlay class so the global title-bar dim
		// (CSS in ciyexCommon.css) and native window-control dimmer
		// (CiyexWindowControlsDimmer) treat it like every other Ciyex add/edit form.
		this.formOverlay.classList.add('ciyex-edit-dialog-overlay');
		this.formOverlay.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;justify-content:flex-end;background:transparent;';

		// Keep the scrim *below* the title bar. The title bar is already dimmed
		// by `brightness(0.75)` (ciyexCommon.css `:has(.ciyex-edit-dialog-overlay)`)
		// and the natively-drawn min/maximize/close controls dim to the matching
		// shade via CiyexWindowControlsDimmer. A full-height backdrop (`inset:0`)
		// would darken the DOM title bar a *second* time, but it can't cover the
		// native controls — leaving them visibly lighter than the rest of the bar.
		// eslint-disable-next-line no-restricted-syntax
		const titlebarEl = overlayDoc.querySelector('.part.titlebar');
		const titlebarHeight = titlebarEl ? (titlebarEl as HTMLElement).getBoundingClientRect().height : 35;

		const backdrop = DOM.append(this.formOverlay, DOM.$('div'));
		backdrop.style.cssText = `position:absolute;top:${titlebarHeight}px;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);`;
		backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) { this._closeForm(); } });

		// Dialog (right-side panel) — flex column so header+footer are sticky and
		// only the body scrolls. overflow:hidden on the dialog itself removes the
		// outer scrollbar the user reported.
		// color-scheme follows the active workbench theme so native form chrome
		// (option popup, date picker, scrollbars) renders in the same mode as
		// the dialog. Hard-coding `dark` produced light-on-light forms when the
		// user was on a light theme (issue #18).
		const themeType = this.themeService.getColorTheme().type;
		const colorScheme = themeType === 'light' || themeType === 'hcLight' ? 'light' : 'dark';

		// Full-height right-side drawer: flush to the top (just below the title
		// bar so the window controls stay clickable) and to the bottom edge, with
		// no rounded corners — previously a 12px gap + radius all around made the
		// panel float as a card with dead space above and below (QA-flagged).
		const dialog = DOM.append(this.formOverlay, DOM.$('div'));
		dialog.className = 'cle-form-dialog';
		dialog.style.cssText = `position:relative;width:560px;max-width:95vw;height:calc(100% - ${titlebarHeight}px);margin-top:${titlebarHeight}px;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));border-left:1px solid var(--vscode-editorWidget-border);display:flex;flex-direction:column;overflow:hidden;box-shadow:-8px 0 24px rgba(0,0,0,0.3);z-index:1;color:var(--vscode-foreground);color-scheme:${colorScheme};`;
		// Force native <option> backgrounds to use the VS Code dropdown vars so
		// the dropdown popup matches the rest of the dialog rather than rendering
		// white on dark themes.
		const dialogStyle = DOM.append(dialog, DOM.$('style'));
		dialogStyle.textContent = [
			'.cle-form-dialog select, .cle-form-dialog option {',
			'  background:var(--vscode-dropdown-background, var(--vscode-input-background));',
			'  color:var(--vscode-dropdown-foreground, var(--vscode-input-foreground));',
			'}',
			'.cle-form-dialog input, .cle-form-dialog textarea {',
			'  background:var(--vscode-input-background);',
			'  color:var(--vscode-input-foreground);',
			'}',
			'.cle-form-dialog input::placeholder, .cle-form-dialog textarea::placeholder {',
			'  color:var(--vscode-input-placeholderForeground, var(--vscode-descriptionForeground));',
			'}',
		].join('\n');

		const header = DOM.append(dialog, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid var(--vscode-editorWidget-border);position:sticky;top:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));z-index:2;';

		const title = DOM.append(header, DOM.$('h3'));
		if (isEdit && cfg.editTitle && this.editingItem) {
			title.textContent = cfg.editTitle(this.editingItem);
		} else {
			title.textContent = isEdit ? `Edit ${cfg.title.replace(/s$/, '')}` : `New ${cfg.title.replace(/s$/, '')}`;
		}
		title.style.cssText = 'margin:0;font-size:16px;font-weight:600;';


		// Form body — flex:1 fills the space between header and footer.
		// Two-column grid lets form fields sit side-by-side (use width:'span 2'
		// on a field to make it span both columns).
		// Scrollbar is hidden via scrollbar-width + -webkit trick so the panel
		// never shows an outer scrollbar — content still scrolls when needed.
		const body = DOM.append(dialog, DOM.$('div'));
		body.className = 'cle-form-body';
		body.style.cssText = 'flex:1;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;padding:20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start;';
		const bodyStyleEl = DOM.append(dialog, DOM.$('style'));
		bodyStyleEl.textContent = 'div.cle-form-body::-webkit-scrollbar{display:none;width:0;height:0;}';

		const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
		// For date fields we hold direct refs to the visible mm/dd/yyyy input and the
		// picker so we can seed them when editing — `inputs` only carries the hidden
		// ISO field so save logic stays type-uniform.
		const dateRefs = new Map<string, { visible: HTMLInputElement; picker: HTMLInputElement }>();
		// For strictSelect search fields: lock helpers keyed by field.key so the
		// edit-prefill step can mark an already-saved value as a locked selection.
		const strictLockRefs = new Map<string, (locked: boolean) => void>();
		// Segmented (pill-box) select fields: key → repaint callback so the initial
		// / edit-seeded value highlights the right pill (mirrors dateRefs seeding).
		const segmentedRefs = new Map<string, (value: string) => void>();

		for (const field of fields) {
			// Every typeahead/search field locks to a value chosen from its results
			// dropdown by default: a name typed but not picked from the list (e.g. a
			// provider that doesn't exist) is wiped on blur and rejected on save, so
			// only real records are stored. Opt a field out with `strictSelect:false`
			// for the rare case where free text is genuinely allowed.
			if (field.type === 'search' && field.strictSelect === undefined) {
				field.strictSelect = true;
			}
			const group = DOM.append(body, DOM.$('div'));
			group.style.cssText = field.width ? `grid-column:${field.width};` : '';
			if (field.hidden) {
				// Render an off-screen input so `inputs.get(...)` still resolves it for
				// auto-fill from search results, but keep the field invisible to the user.
				group.style.cssText += ';position:absolute;left:-9999px;visibility:hidden;';
			}

			const label = DOM.append(group, DOM.$('label'));
			label.textContent = field.label + (field.required ? ' *' : '');
			label.style.cssText = 'display:block;font-size:11px;font-weight:500;margin-bottom:4px;color:var(--vscode-descriptionForeground);';

			const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';
			let inputEl: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

			if (field.type === 'select' && field.segmented && field.options) {
				// Segmented pill-box: every option is a clickable chip inside a
				// bordered box (no dropdown to open). A hidden native <select> holds
				// the value so the shared seed (inputEl.value = val) and save
				// (inputs.get(key).value) paths keep working unchanged.
				const hidden = DOM.append(group, DOM.$('select')) as HTMLSelectElement;
				hidden.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0;';
				for (const o of field.options) {
					const opt = DOM.append(hidden, DOM.$('option')) as HTMLOptionElement;
					opt.value = o.value; opt.textContent = o.label;
				}
				const box = DOM.append(group, DOM.$('div'));
				box.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:6px;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;background:var(--vscode-input-background);box-sizing:border-box;';
				const pills = new Map<string, HTMLElement>();
				const paint = (sel: string): void => {
					for (const [v, el] of pills) {
						const on = v === sel;
						el.style.cssText = `padding:4px 12px;border-radius:12px;font-size:12px;line-height:1.4;cursor:pointer;user-select:none;transition:background 0.1s;border:1px solid ${on ? 'var(--vscode-focusBorder,#007fd4)' : 'var(--vscode-input-border,#3c3c3c)'};background:${on ? 'var(--vscode-button-background,#0e639c)' : 'transparent'};color:${on ? 'var(--vscode-button-foreground,#fff)' : 'var(--vscode-foreground)'};font-weight:${on ? '600' : '400'};`;
					}
				};
				for (const o of field.options) {
					const pill = DOM.append(box, DOM.$('span'));
					pill.textContent = o.label;
					pills.set(o.value, pill);
					pill.addEventListener('click', () => { hidden.value = o.value; paint(o.value); });
				}
				inputEl = hidden;
				segmentedRefs.set(field.key, paint);
			} else if (field.type === 'select' && (field.options || field.optionsApiPath)) {
				// Use the shared custom dropdown instead of a native <select>.
				// Native <option> popups are rendered by the OS using its own
				// colour scheme — on dark workbench themes that produces faint
				// grey-on-grey non-highlighted options, which the QA team
				// flagged as the unreadable dropdown across every create/edit
				// form drawer.
				// `dynOptions` is the live array the dropdown reads on every open;
				// for optionsApiPath fields we start empty and fill it after the
				// fetch resolves (issue #13: Category/Location/Supplier dropdowns).
				const dynOptions: Array<{ label: string; value: string }> = field.options ? [...field.options] : [];
				const dropdown = createCustomDropdown({
					parent: group,
					options: dynOptions,
					initialValue: '',
					placeholder: `Select ${field.label}...`,
					triggerStyle: inputStyle + 'min-width:200px;',
				});
				inputEl = dropdown;
				if (field.optionsApiPath) {
					const labelField = field.optionsLabelField || 'name';
					const valueField = field.optionsValueField || 'id';
					void (async () => {
						try {
							const res = await this.apiService.fetch(`${field.optionsApiPath}?page=0&size=200`);
							if (!res.ok) { return; }
							const data = await res.json();
							const wrapper = data?.data ?? data;
							const list = (wrapper?.content || (Array.isArray(wrapper) ? wrapper : [])) as Array<Record<string, unknown>>;
							for (const item of list) {
								const value = item[valueField];
								if (value === undefined || value === null) { continue; }
								dynOptions.push({ label: String(item[labelField] ?? value), value: String(value) });
							}
							// Re-assert the current value so a seeded edit value now
							// resolves to its freshly-loaded label.
							dropdown.value = dropdown.value;
						} catch { /* leave dropdown empty on failure */ }
					})();
				}
			} else if (field.type === 'textarea') {
				inputEl = DOM.append(group, DOM.$('textarea')) as HTMLTextAreaElement;
				// Issue #17: 60px was too tall — the prescription dialog felt
				// dominated by the Notes textarea. 40px keeps two visible lines
				// and the user can still drag-resize for longer entries.
				inputEl.style.cssText = inputStyle + 'min-height:40px;max-height:120px;resize:vertical;font-family:inherit;';
				inputEl.placeholder = field.placeholder || '';
			} else if (field.type === 'search' && (field.apiPath || field.searchApiPath)) {
				// Search field with live autocomplete dropdown. The match
				// dropdown is mounted on document.body with position:fixed
				// so it escapes the form grid's overflow / transform stack
				// and never renders behind the next row's label — the bug
				// QA reported where "Michael John" appeared overlapping the
				// "Priority" label below the Provider input.
				const searchWrapper = DOM.append(group, DOM.$('div'));
				searchWrapper.style.cssText = 'position:relative;';

				inputEl = DOM.append(searchWrapper, DOM.$('input')) as HTMLInputElement;
				inputEl.type = 'text';
				inputEl.style.cssText = inputStyle;
				inputEl.placeholder = field.placeholder || `Search ${field.label}...`;

				// `strictSelect`: the value must come from the results dropdown. We
				// lock the input after a pick (no free typing) and expose a clear
				// button to re-search. Unselected free text is wiped on blur so it can
				// never be saved as if it were a real record.
				const strictInput = inputEl as HTMLInputElement;
				let lockSelection: ((locked: boolean) => void) | undefined;
				if (field.strictSelect) {
					const clearBtn = DOM.append(searchWrapper, DOM.$('span'));
					clearBtn.textContent = '\u2715';
					clearBtn.title = 'Clear selection';
					clearBtn.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);cursor:pointer;font-size:12px;color:var(--vscode-descriptionForeground);display:none;line-height:1;';
					lockSelection = (locked: boolean): void => {
						strictInput.readOnly = locked;
						strictInput.dataset.selected = locked ? '1' : '';
						clearBtn.style.display = locked ? 'block' : 'none';
					};
					clearBtn.addEventListener('click', () => {
						lockSelection!(false);
						strictInput.value = '';
						if (field.relatedField) { const ri = inputs.get(field.relatedField); if (ri) { ri.value = ''; } }
						strictInput.focus();
					});
					strictLockRefs.set(field.key, lockSelection);
				}

				const ownerDoc = group.ownerDocument || document;
				// Mount the autocomplete dropdown on the form OVERLAY rather than
				// document.body. The overlay isn't clipped (only the inner dialog
				// sets overflow:hidden) and position:fixed keeps the dropdown
				// viewport-anchored, so it still escapes the dialog's clipping — but
				// now it is removed together with the overlay when the form closes
				// instead of leaking. The old body-mount + MutationObserver never
				// fired on whole-overlay removal, so orphaned `.monaco-workbench`
				// dropdowns piled up behind the app (QA: background render glitch).
				const dropdownHost = this.formOverlay ?? (ownerDoc.body || ownerDoc.documentElement);
				const dropdown = DOM.append(dropdownHost, DOM.$('div'));
				// monaco-workbench class makes --vscode-* vars resolve even if the
				// host falls back to body.
				dropdown.className = 'monaco-workbench';
				dropdown.style.cssText = 'position:fixed;overflow-y:auto;background:var(--vscode-editorWidget-background,#1e1e1e);color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,0.35));border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.45);z-index:10001;display:none;';
				const positionDropdown = () => {
					const rect = (inputEl as HTMLInputElement).getBoundingClientRect();
					const viewportH = win?.innerHeight ?? ownerDoc.documentElement.clientHeight;
					const gap = 2;
					const spaceBelow = viewportH - rect.bottom - gap - 8;
					const spaceAbove = rect.top - gap - 8;
					// Flip the panel above the input when there isn't room below it (a
					// field low in a wide/short drawer) so results are never clipped off
					// the bottom of the viewport. Cap the height to whichever side is
					// used so the list stays fully on-screen at any window size.
					const flipUp = spaceBelow < 160 && spaceAbove > spaceBelow;
					const maxH = Math.max(120, Math.min(280, flipUp ? spaceAbove : spaceBelow));
					dropdown.style.left = `${rect.left}px`;
					dropdown.style.width = `${rect.width}px`;
					dropdown.style.maxHeight = `${maxH}px`;
					if (flipUp) {
						dropdown.style.top = 'auto';
						dropdown.style.bottom = `${viewportH - rect.top + gap}px`;
					} else {
						dropdown.style.bottom = 'auto';
						dropdown.style.top = `${rect.bottom + gap}px`;
					}
				};
				const repositionDropdown = () => { if (dropdown.style.display === 'block') { positionDropdown(); } };
				const win = ownerDoc.defaultView;
				win?.addEventListener('scroll', repositionDropdown, true);
				win?.addEventListener('resize', repositionDropdown);
				// The dropdown DOM is reclaimed with the overlay; only the window
				// listeners need explicit teardown on form close.
				this.formListenerCleanups.push(() => {
					win?.removeEventListener('scroll', repositionDropdown, true);
					win?.removeEventListener('resize', repositionDropdown);
				});
				const showDropdown = () => { positionDropdown(); dropdown.style.display = 'block'; };

				const searchEndpoint = field.apiPath || field.searchApiPath || '';
				const displayField = field.searchDisplayField || 'name';
				const valueField = field.searchValueField || 'id';

				inputEl.addEventListener('input', () => {
					const timerKey = field.key;
					const existing = this.searchDebounceTimers.get(timerKey);
					if (existing) { clearTimeout(existing); }
					const query = (inputEl as HTMLInputElement).value.trim();
					if (query.length < 2) {
						dropdown.style.display = 'none';
						DOM.clearNode(dropdown);
						return;
					}
					this.searchDebounceTimers.set(timerKey, setTimeout(async () => {
						let results: Record<string, unknown>[] = [];
						// Track an upstream service failure (e.g. the ciyex-codes
						// proxy returning 5xx) so we can tell the user the lookup
						// service is down rather than silently showing "No results".
						let serviceError = false;
						try {
							const param = field.searchParam || 'search';
							const sep = searchEndpoint.includes('?') ? '&' : '?';
							const res = await this.apiService.fetch(`${searchEndpoint}${sep}${param}=${encodeURIComponent(query)}&page=0&size=15`);
							if (res.ok) {
								const data = await res.json();
								const wrapper = data?.data || data;
								results = wrapper?.content || (Array.isArray(wrapper) ? wrapper : []);
							} else if (res.status >= 500) {
								serviceError = true;
							}
						} catch {
							serviceError = true;
						}
						// Patient-coverage merge: the selected patient's EXISTING insurance
						// names must be offerable alongside (and ahead of) the org's
						// insurance-companies catalog — the catalog can be empty OR return
						// unrelated rows for the query, and either way the patient's
						// snapshot insurance ("XYZ") was unfindable, blocking the Prior
						// Auth (QA: typed name showed "No results found" / wrong entries).
						if (field.patientCoverageFallback) {
							const pid = inputs.get('patientId')?.value.trim();
							if (pid) {
								try {
									const covRes = await this.apiService.fetch(`/api/fhir-resource/insurance-coverage/patient/${encodeURIComponent(pid)}?page=0&size=25`);
									if (covRes.ok) {
										const covData = await covRes.json();
										const covWrapper = covData?.data || covData;
										const covRows: Record<string, unknown>[] = covWrapper?.content || (Array.isArray(covWrapper) ? covWrapper : []);
										const lq = query.toLowerCase();
										const seenNames = new Set<string>();
										const covMatches = covRows
											.map(c => String(c['payerName'] ?? c['insuranceName'] ?? c['insuranceCompanyName'] ?? '').trim())
											.filter(n => n && n.toLowerCase().includes(lq))
											.filter(n => { const k = n.toLowerCase(); if (seenNames.has(k)) { return false; } seenNames.add(k); return true; })
											.map(n => ({ name: n }));
										// Patient coverage first — it is the most likely pick for a
										// prior auth; the display-text dedupe below drops catalog
										// rows that repeat the same name.
										results = [...covMatches, ...results];
									}
								} catch { /* keep the catalog results */ }
							}
						}
						// Client-side fallback when API returns empty/fails (e.g. CVX codes
						// when ciyex-codes has no CVX data loaded).
						if (results.length === 0 && field.fallbackOptions && field.fallbackOptions.length > 0) {
							const lq = query.toLowerCase();
							results = field.fallbackOptions
								.filter(opt => Object.values(opt).some(v => String(v).toLowerCase().includes(lq)))
								.slice(0, 15);
						}
						DOM.clearNode(dropdown);
						if (results.length === 0) {
							const noRes = DOM.append(dropdown, DOM.$('div'));
							noRes.textContent = serviceError ? 'Code lookup service unavailable — try again later' : 'No results found';
							noRes.style.cssText = `padding:8px 10px;font-size:12px;color:${serviceError ? '#f59e0b' : 'var(--vscode-descriptionForeground)'};`;
							showDropdown();
							return;
						}
						{
							// When the field keeps ONLY the display text (no relatedField /
							// relatedFieldsMap carries an id along), two results with the
							// same text are indistinguishable after the pick — showing both
							// is pure noise (QA: Insurance Name dropdown listed duplicate
							// names). Fields that fill a related id (patients, providers)
							// must keep same-name entries: they are different records.
							const displayOnly = !field.relatedField && !field.relatedFieldsMap;
							const seenDisplays = new Set<string>();
							for (const result of results.slice(0, 15)) {
								// Supports dot-path notation (e.g. 'identification.firstName') for nested DTO fields.
								const getPath = (obj: Record<string, unknown>, path: string): unknown =>
									path.split('.').reduce<unknown>((acc, k) => (acc !== null && acc !== undefined ? (acc as Record<string, unknown>)[k] : undefined), obj);

								// Build display text
								let displayText = String(getPath(result, displayField) ?? '');
								if (field.relatedDisplayFields) {
									const parts = field.relatedDisplayFields.map(f => String(getPath(result, f) ?? '')).filter(Boolean);
									if (parts.length > 0) { displayText = parts.join(' '); }
								}
								if (!displayText) {
									// Fallback: try firstName + lastName at the top level, then
									// nested under `identification` (provider DTOs nest the name
									// there), before giving up and showing the bare value field.
									const fn = String(getPath(result, 'firstName') ?? getPath(result, 'identification.firstName') ?? '');
									const ln = String(getPath(result, 'lastName') ?? getPath(result, 'identification.lastName') ?? '');
									displayText = [fn, ln].filter(Boolean).join(' ') || String(getPath(result, valueField) ?? '');
								}
								if (displayOnly) {
									const norm = displayText.trim().toLowerCase();
									if (seenDisplays.has(norm)) { continue; }
									seenDisplays.add(norm);
								}
								const item = DOM.append(dropdown, DOM.$('div'));
								item.textContent = displayText;
								item.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.08);';
								item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
								item.addEventListener('mouseleave', () => { item.style.background = ''; });
								// MOUSEDOWN, not click: the input's blur (fired by the row's
								// mousedown) hides this dropdown 200ms later, so a press longer
								// than that swallowed the click and picking took TWO clicks
								// (QA: dropdown options select only on double click).
								item.addEventListener('mousedown', (e) => {
									e.preventDefault();
									// When `selectDisplayField` is set, the input shows only that
									// field (e.g. the description) while the dropdown still shows the
									// fuller `displayText` (code + description). Otherwise fall back to
									// the dropdown text so existing search fields are unchanged.
									(inputEl as HTMLInputElement).value = field.selectDisplayField
										? String(getPath(result, field.selectDisplayField) ?? displayText)
										: displayText;
									dropdown.style.display = 'none';
									// Auto-fill related field (e.g. patientId)
									if (field.relatedField) {
										const relatedInput = inputs.get(field.relatedField);
										if (relatedInput) {
											relatedInput.value = String(result[valueField] ?? '');
											// Mark the companion as a confirmed selection so, if it is
											// itself a strict-select search field, the submit-time guard
											// doesn't wipe this auto-filled value (issue 1 / issue 12).
											relatedInput.dataset.selected = '1';
										}
									}
									// Auto-fill additional related fields from the result (e.g. patientLastName, phone).
									// `resultKey` may list several candidate source keys separated by '||'
									// (e.g. 'phoneNumber||phone||mobile') so the first one the API actually
									// returns wins — different endpoints name the same value differently.
									if (field.relatedFieldsMap) {
										for (const [formKey, resultKey] of Object.entries(field.relatedFieldsMap)) {
											const relatedInput = inputs.get(formKey);
											if (relatedInput) {
												let v: unknown;
												for (const candidate of resultKey.split('||')) {
													v = getPath(result, candidate.trim());
													if (v !== null && v !== undefined && String(v) !== '') { break; }
												}
												relatedInput.value = String(v ?? '');
											}
										}
									}
									// strictSelect: lock the field after a valid pick so the user
									// can't append free text to a selected provider.
									lockSelection?.(true);
								});
							}
							showDropdown();
						}
					}, 300));
				});

				// Hide dropdown on blur (with delay for click)
				inputEl.addEventListener('blur', () => {
					setTimeout(() => {
						dropdown.style.display = 'none';
						// strictSelect: if the user typed without picking a result, wipe the
						// stray text (and its related id) so only a real selection survives.
						const relatedFilled = !!(field.relatedField && inputs.get(field.relatedField)?.value.trim());
						if (field.strictSelect && strictInput.dataset.selected !== '1' && strictInput.value && !relatedFilled) {
							strictInput.value = '';
							if (field.relatedField) { const ri = inputs.get(field.relatedField); if (ri) { ri.value = ''; } }
						}
					}, 200);
				});
				inputEl.addEventListener('focus', () => {
					if (dropdown.childElementCount > 0) { showDropdown(); }
				});
			} else if (field.type === 'date') {
				// mm/dd/yyyy text + calendar icon inside the field. Native `<input type="date">`
				// renders in OS-locale order on Linux Electron (yyyy-mm-dd), so we render
				// the US format ourselves and overlay a hidden picker that opens via the icon.
				const wrap = DOM.append(group, DOM.$('div'));
				wrap.style.cssText = 'position:relative;display:block;';
				const isoToUs = (iso: string): string => {
					const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
					return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
				};
				// usToIsoDate validates real calendar dates (month 1-12, day in
				// range, year 1900-2100) and returns '' for nonsense like 31/45/6676,
				// so the red border + save-time guard below catch impossible dates.
				const usToIso = (us: string): string => usToIsoDate(us);
				const visible = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				visible.type = 'text';
				visible.placeholder = 'MM/DD/YYYY';
				// Reserve right padding so the icon doesn't overlap typed text.
				visible.style.cssText = inputStyle + 'padding-right:30px;';
				visible.maxLength = 10;
				const hidden = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				hidden.type = 'hidden';
				// Inline validation hint shown directly under the field. usToIsoDate
				// returns '' for an impossible calendar date (e.g. 23/45/2000), so we
				// flag the field red AND surface a readable message immediately as the
				// user types — not only when they hit Save (QA: date fields silently
				// accept invalid dates with no error message).
				const dateErr = DOM.append(wrap, DOM.$('div'));
				dateErr.style.cssText = 'font-size:10px;color:#ef4444;margin-top:3px;display:none;';
				const syncDateError = () => {
					const iso = usToIso(visible.value);
					const bad = !!visible.value && !iso;
					visible.style.borderColor = bad ? '#ef4444' : '';
					dateErr.textContent = bad ? 'Invalid date — please enter a real date (MM/DD/YYYY)' : '';
					dateErr.style.display = bad ? 'block' : 'none';
				};
				visible.addEventListener('input', () => {
					// Auto-insert slashes and cap the year at 4 digits as the user types.
					const masked = maskUsDate(visible.value);
					if (masked !== visible.value) { visible.value = masked; }
					hidden.value = usToIso(visible.value);
					syncDateError();
				});
				visible.addEventListener('blur', syncDateError);
				// Native picker — fully overlaid on top of the icon area so clicking
				// the icon opens the calendar. We hide the native chrome via opacity:0.
				const picker = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
				picker.type = 'date';
				picker.title = 'Open calendar';
				// minDate: constrain the native calendar so an out-of-range date
				// (e.g. a past-year admin date) can't be picked. Save-time validation
				// below still guards typed input.
				if (field.minDate) { picker.min = resolveMinDate(field.minDate); }
				// maxDate: block a future (e.g. a Date Issued dated in a future year)
				// from being picked in the calendar; save-time validation guards typing.
				if (field.maxDate) { picker.max = resolveMaxDate(field.maxDate); }
				picker.style.cssText = 'position:absolute;top:0;right:0;width:30px;height:100%;opacity:0;cursor:pointer;border:none;background:transparent;color-scheme:dark light;padding:0;margin:0;';
				picker.addEventListener('change', () => {
					visible.value = isoToUs(picker.value);
					hidden.value = picker.value;
					visible.style.borderColor = '';
					dateErr.textContent = '';
					dateErr.style.display = 'none';
				});
				// Visible icon — clickable so clicking the glyph itself opens the picker too
				const icon = DOM.append(wrap, DOM.$('span.codicon.codicon-calendar'));
				icon.style.cssText = 'position:absolute;right:8px;top:50%;transform:translateY(-50%);font-size:14px;color:var(--vscode-descriptionForeground);cursor:pointer;line-height:1;';
				// Open the calendar from a click anywhere in the icon column, not just
				// the native input's tiny indicator glyph.
				enablePickerClick(picker, icon);
				dateRefs.set(field.key, { visible, picker });
				inputEl = hidden;
			} else {
				inputEl = DOM.append(group, DOM.$('input')) as HTMLInputElement;
				inputEl.type = field.type;
				inputEl.style.cssText = inputStyle;
				inputEl.placeholder = field.placeholder || '';
				// readOnly: lock the field so the user can't edit it. Auto-fill from a
				// related search field still writes via `.value` (readOnly only blocks
				// user input), so e.g. the recall Phone/Email stay populated from the
				// chosen patient but can never be hand-edited.
				if (field.readOnly) {
					(inputEl as HTMLInputElement).readOnly = true;
					inputEl.style.cssText = inputStyle + 'opacity:0.7;cursor:not-allowed;';
					inputEl.tabIndex = -1;
				}
				// typingPattern: enforce allowed characters at keystroke/paste/input level.
				if (field.typingPattern) {
					const tpRe = new RegExp(field.typingPattern);
					const navKeys = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
					inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
						if (navKeys.includes(e.key) || e.ctrlKey || e.metaKey) { return; }
						if (!tpRe.test(e.key)) { e.preventDefault(); }
					});
					inputEl.addEventListener('paste', (e: ClipboardEvent) => {
						e.preventDefault();
						const t = e.clipboardData?.getData('text') ?? '';
						const filtered = t.split('').filter(c => tpRe.test(c)).join('');
						if (filtered) { DOM.getActiveWindow().document.execCommand('insertText', false, filtered); }
					});
					inputEl.addEventListener('input', () => {
						const clean = (inputEl as HTMLInputElement).value.split('').filter(c => tpRe.test(c)).join('');
						if (clean !== (inputEl as HTMLInputElement).value) { (inputEl as HTMLInputElement).value = clean; }
					});
				}
				// maxDigits: cap the number of digits the field can hold (e.g. fax
				// number <= 12). Strips any digit typed past the limit while keeping
				// the user's separators, so the field can never carry more digits
				// than allowed (the validationPattern enforces the exact count on save).
				if (field.maxDigits) {
					const maxDigits = field.maxDigits;
					const capEl = inputEl as HTMLInputElement;
					capEl.addEventListener('input', () => {
						if (capEl.value.replace(/\D/g, '').length <= maxDigits) { return; }
						let kept = '';
						let count = 0;
						for (const ch of capEl.value) {
							if (/\d/.test(ch)) {
								if (count >= maxDigits) { continue; }
								count++;
							}
							kept += ch;
						}
						capEl.value = kept;
					});
				}
				if (field.type === 'number') {
					// Do NOT set HTML5 min/max attributes — Chromium silently clears
					// the input value when the typed value falls outside [min,max],
					// which makes our required-check fire with "field is required"
					// instead of the field-specific range message. All range validation
					// is handled explicitly in the save-click handler below.
					inputEl.setAttribute('data-min', String(field.minValue ?? ''));
					inputEl.setAttribute('data-max', String(field.maxValue ?? ''));
					// Positive-integer fields (minValue >= 1) must never accept
					// alphabets, negatives, decimals, or scientific notation.
					// Three-layer defence:
					//   1. keydown — blocks individual keystrokes before they land
					//      (covers -, ., e, E, + and all letter keys).
					//   2. paste — strips non-digits from pasted content so
					//      clipboard paste cannot bypass the keydown guard.
					//   3. input — final backstop that scrubs any character that
					//      slips through (e.g. IME, drag-and-drop).
					if ((field.minValue ?? 0) >= 1) {
						inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
							const nav = ['Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
								'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
							if (nav.includes(e.key) || e.ctrlKey || e.metaKey) { return; }
							if (!/^\d$/.test(e.key)) { e.preventDefault(); }
						});
						inputEl.addEventListener('paste', (e: ClipboardEvent) => {
							e.preventDefault();
							const text = e.clipboardData?.getData('text') ?? '';
							const digitsOnly = text.replace(/\D/g, '');
							if (digitsOnly) {
								DOM.getActiveWindow().document.execCommand('insertText', false, digitsOnly);
							}
						});
						inputEl.addEventListener('input', () => {
							const clean = inputEl.value.replace(/\D/g, '');
							if (clean !== inputEl.value) { inputEl.value = clean; }
						});
					}
				}
			}

			// Set value from editing item (with alias lookup) or default
			let val: string;
			if (isEdit) {
				const resolved = this._readFieldValue(field);
				val = resolved === undefined || resolved === null ? '' : String(resolved);
			} else {
				const dv = field.defaultValue;
				val = typeof dv === 'function' ? String((dv as () => string | number)()) : String(dv ?? '');
			}
			inputEl.value = val;
			// Segmented pill-box: highlight the pill matching the seeded value.
			if (field.type === 'select' && field.segmented) { segmentedRefs.get(field.key)?.(val); }
			// strictSelect search field opened for edit with a saved value — treat
			// it as an existing selection: lock it (read-only + clear button to change) so the
			// blur-clear doesn't wipe the already-saved provider.
			if (field.type === 'search' && field.strictSelect && val) {
				strictLockRefs.get(field.key)?.(true);
			}
			// For date fields the registered input is the hidden ISO field — also seed
			// the visible mm/dd/yyyy text and the picker so the user sees the current
			// value when editing.
			if (field.type === 'date' && val) {
				const iso = val.split('T')[0];
				const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
				const refs = dateRefs.get(field.key);
				if (m && refs) {
					refs.visible.value = `${m[2]}/${m[3]}/${m[1]}`;
					refs.picker.value = iso;
				}
			}

			// Standard editing shortcuts (paste/copy/cut/select-all/undo/redo) must
			// reach the focused field's native handler. The form is mounted inside the
			// workbench, whose keybinding service otherwise intercepts Ctrl/Cmd+V on
			// keydown before the input sees it — so pasting into a field (e.g. a
			// Medical Code's Full Description) silently did nothing (QA report
			// 2026-07-10, issue 6). Stop propagation so the browser handles them here.
			(inputEl as HTMLElement).addEventListener('keydown', (e: KeyboardEvent) => {
				if ((e.ctrlKey || e.metaKey) && !e.altKey) {
					const k = e.key.toLowerCase();
					if (k === 'v' || k === 'c' || k === 'x' || k === 'a' || k === 'z' || k === 'y') {
						e.stopPropagation();
					}
				}
			});

			inputs.set(field.key, inputEl);
		}

		// formExtras hook (issue #23) — lets configs (e.g. Care Plans) render
		// dynamic Goals / Interventions lists inside the dialog and contribute
		// extra payload fields at save time.
		const extrasHost = DOM.append(body, DOM.$('div'));
		extrasHost.style.cssText = 'grid-column:span 2;';
		const extras = cfg.formExtras ? cfg.formExtras(extrasHost, this.editingItem) : null;

		// Error area — spans both columns so it's always visible above the footer.
		const errorEl = DOM.append(body, DOM.$('div'));
		errorEl.style.cssText = 'grid-column:span 2;color:#f48771;font-size:12px;display:none;';

		// Footer
		const footer = DOM.append(dialog, DOM.$('div'));
		footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--vscode-editorWidget-border);position:sticky;bottom:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));z-index:2;';

		const cancelBtn = DOM.append(footer, DOM.$('button'));
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:6px 14px;border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:12px;background:transparent;color:var(--vscode-foreground);';
		cancelBtn.addEventListener('click', () => this._closeForm());

		const saveBtn = DOM.append(footer, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
		saveBtn.style.cssText = 'padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;font-weight:500;';
		saveBtn.addEventListener('click', async () => {
			// Reset prior validation state
			const clearError = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined) => {
				if (!input) { return; }
				input.style.borderColor = '';
				input.addEventListener('input', () => { input.style.borderColor = ''; }, { once: true });
				input.addEventListener('change', () => { input.style.borderColor = ''; }, { once: true });
			};
			for (const input of inputs.values()) { clearError(input); }
			const failValidation = (input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined, msg: string, field: FormFieldDef) => {
				errorEl.textContent = msg;
				errorEl.style.display = 'block';
				if (input) {
					input.style.borderColor = '#ef4444';
					if (!field.hidden) { input.focus(); }
				}
			};
			// Validate required fields + patterns + ranges
			for (const field of fields) {
				// strictSelect: the value must come from the results dropdown. If text
				// is present but no result was picked (dataset flag not set), reject —
				// this also covers the case where Save is clicked before the blur-clear
				// timer fires, so free-typed names can never be saved.
				if (field.type === 'search' && field.strictSelect) {
					const input = inputs.get(field.key);
					// Treat the field as a confirmed pick when its companion code/id
					// (relatedField) is already populated — a filled companion can only
					// come from a dropdown selection. This stops a stale `dataset.selected`
					// flag from wiping a valid auto-filled code on Create (issue 1: Lab
					// Order "Test Code disappears on Create").
					const relatedFilled = !!(field.relatedField && inputs.get(field.relatedField)?.value.trim());
					if (input && input.value.trim() && input.dataset.selected !== '1' && !relatedFilled) {
						input.value = '';
						if (field.relatedField) { const ri = inputs.get(field.relatedField); if (ri) { ri.value = ''; } }
						failValidation(input, field.validationMessage || `Please select ${field.label} from the search results`, field);
						return;
					}
				}
				if (field.required) {
					const input = inputs.get(field.key);
					if (!input || !input.value.trim()) {
						failValidation(input, field.validationMessage || `${field.label} is required`, field);
						return;
					}
				}
				if (field.validationPattern) {
					const input = inputs.get(field.key);
					const v = input?.value.trim() || '';
					if (v && !new RegExp(field.validationPattern).test(v)) {
						failValidation(input, field.validationMessage || `${field.label} format is invalid`, field);
						return;
					}
				}
				// Date fields: the registered input is the hidden ISO field, which is
				// '' whenever the visible MM/DD/YYYY text isn't a real calendar date
				// (usToIsoDate rejects month 31, day 45, year 6676, …). If the user
				// typed something but it didn't parse, reject rather than silently
				// saving an empty date.
				if (field.type === 'date') {
					const refs = dateRefs.get(field.key);
					const typed = refs?.visible.value.trim() || '';
					const iso = inputs.get(field.key)?.value.trim() || '';
					if (typed && !iso) {
						failValidation(refs?.visible, field.validationMessage || `${field.label} must be a valid date (MM/DD/YYYY)`, field);
						return;
					}
					// minDate: reject a date earlier than the allowed floor. ISO dates
					// sort lexicographically, so a plain string compare is correct.
					if (iso && field.minDate) {
						const min = resolveMinDate(field.minDate);
						if (iso < min) {
							failValidation(refs?.visible, field.validationMessage || `${field.label} cannot be a past-year date`, field);
							return;
						}
					}
					// maxDate: reject a date later than the allowed ceiling (e.g. a
					// future-year "Date Issued").
					if (iso && field.maxDate) {
						const max = resolveMaxDate(field.maxDate);
						if (iso > max) {
							failValidation(refs?.visible, field.validationMessage || `${field.label} cannot be a future date`, field);
							return;
						}
					}
				}
				if (field.type === 'number') {
					const input = inputs.get(field.key);
					const v = input?.value.trim() || '';
					if (v) {
						const n = Number(v);
						if (!isFinite(n) || isNaN(n)) {
							failValidation(input, field.validationMessage || `${field.label} must be a valid number`, field);
							return;
						}
						if (!Number.isInteger(n) && field.validationPattern && /^\[1-9\]/.test(field.validationPattern)) {
							failValidation(input, field.validationMessage || `${field.label} must be a whole number`, field);
							return;
						}
						const minV = field.minValue !== undefined ? field.minValue : undefined;
						if (minV !== undefined && n < minV) {
							failValidation(input, field.validationMessage || `${field.label} must be ${minV} or greater`, field);
							return;
						}
						if (field.maxValue !== undefined && n > field.maxValue) {
							failValidation(input, field.validationMessage || `${field.label} must be ${field.maxValue} or less`, field);
							return;
						}
					}
				}
			}

			// Cross-field date-order guard (e.g. Care Plans end date must not precede
			// the start date). The registered date input holds the ISO value, which
			// sorts lexicographically, so a plain string compare is correct.
			if (cfg.endNotBeforeStart) {
				const { startKey, endKey, message } = cfg.endNotBeforeStart;
				const startVal = inputs.get(startKey)?.value.trim() || '';
				const endVal = inputs.get(endKey)?.value.trim() || '';
				if (startVal && endVal && endVal < startVal) {
					const endField = fields.find(f => f.key === endKey) || fields[0];
					const startLabel = fields.find(f => f.key === startKey)?.label || 'Start Date';
					const focusEl = dateRefs.get(endKey)?.visible ?? inputs.get(endKey);
					failValidation(focusEl, message || `${endField.label} cannot be earlier than ${startLabel}`, endField);
					return;
				}
			}

			// Build payload from form values
			const formValues: Record<string, unknown> = {};
			for (const field of fields) {
				const input = inputs.get(field.key);
				if (!input) { continue; }
				const v = input.value.trim();
				if (field.type === 'number') {
					formValues[field.key] = v === '' ? null : Number(v);
				} else if (field.type === 'select' && (field.options || []).length > 0
					&& (field.options || []).every(o => o.value === 'true' || o.value === 'false')) {
					// Boolean-backed select (options are exactly true/false): the form
					// value is the STRING 'true'/'false', but the backend field is a
					// boolean and any non-empty string is truthy. Coerce so toggling a
					// Medical Code Active→Inactive actually persists as `false` instead
					// of staying Active (QA issue 10).
					formValues[field.key] = v === 'true';
				} else {
					formValues[field.key] = v;
				}
			}
			// Merge dynamic-list fields contributed by formExtras (issue #23).
			if (extras) {
				const extraValues = extras.collect();
				for (const [k, v] of Object.entries(extraValues)) {
					formValues[k] = v;
				}
			}

			let payload: Record<string, unknown>;
			if (isEdit && cfg.mergeOnEdit && this.editingItem) {
				// Merge form values onto the original record; strip nested objects
				// with null/undefined id (backend rejects them with "id cannot be null").
				const merged = { ...this.editingItem, ...formValues };
				payload = {};
				for (const [k, v] of Object.entries(merged)) {
					if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
						const obj = v as Record<string, unknown>;
						if (Object.prototype.hasOwnProperty.call(obj, 'id')) {
							const nestedId = obj.id;
							if (nestedId === null || nestedId === undefined) { continue; }
						}
					}
					payload[k] = v;
				}
			} else {
				payload = formValues;
			}

			// Apply create-time defaults for fields the form doesn't surface.
			if (!isEdit && cfg.createDefaults) {
				for (const [k, v] of Object.entries(cfg.createDefaults)) {
					if (payload[k] === undefined || payload[k] === null || payload[k] === '') {
						payload[k] = v;
					}
				}
			}
			if (cfg.beforeSave) {
				payload = cfg.beforeSave(payload, isEdit, this.editingItem);
			}

			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';

			try {
				let url: string;
				if (isEdit) {
					// Use the original record's identifiers for the URL — the resource being
					// updated is identified by its DB-side IDs (patientId, id), which are
					// immutable post-create. Form-edited values go in the body, not the path.
					url = cfg.buildItemUrl
						? cfg.buildItemUrl(this.editingItem!)
						: `${cfg.apiPath}/${this.editingItem!.id}`;
				} else {
					url = cfg.buildCreateUrl ? cfg.buildCreateUrl(payload) : cfg.apiPath;
				}
				const method = isEdit ? 'PUT' : 'POST';
				const res = await this.apiService.fetch(url, {
					method,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				});
				if (res.ok) {
					this._closeForm();
					// Reflect the change instantly from the save response so the row
					// appears/updates the moment Save completes, instead of waiting on a
					// second full-list GET. The background reconcile below then pulls the
					// canonical server state (computed fields, sort order, totals).
					const saved = await parseSavedRecord(res);
					// afterSave bookkeeping (e.g. persist Medical Code Active/Inactive
					// locally since the backend ignores it). Runs BEFORE _loadData so the
					// enrichItems re-apply below sees the freshly-stored override.
					if (cfg.afterSave) {
						const rec: Record<string, unknown> = { ...payload, ...(saved ?? {}) };
						if (rec.id === undefined || rec.id === null) { rec.id = this.editingItem?.id; }
						try { cfg.afterSave(rec, isEdit); } catch { /* best-effort */ }
					}
					if (isEdit) {
						// Patch the edited row in place — it's already visible on this page.
						const editedId = this.editingItem?.id;
						const patch = saved ?? payload;
						if (editedId !== undefined && editedId !== null) {
							this.items = this.items.map(it => it.id === editedId ? { ...it, ...patch } : it);
							this._render();
						}
					} else if (this.currentPage === 0 && !this.searchValue && !this.statusFilter && !this.priorityFilter) {
						// Only prepend a freshly-created record on the unfiltered first
						// page, where it unambiguously belongs at the top; an active
						// search/filter or a later page is reconciled by the GET below.
						const created = saved ?? payload;
						this.items = [created, ...this.items];
						this._render();
					}
					if (cfg.statsPath) { void this._loadStats(); }
					void this._loadData();
				} else {
					const errData = await res.json().catch(() => null) as Record<string, unknown> | null;
					const msg = (errData?.['message'] as string)
						|| (errData?.['error'] as string)
						|| (Array.isArray(errData?.['errors']) ? (errData!['errors'] as string[]).join('; ') : '')
						|| `Error: ${res.status}`;
					errorEl.textContent = String(msg);
					errorEl.style.display = 'block';
				}
			} catch (err) {
				errorEl.textContent = 'Network error';
				errorEl.style.display = 'block';
			} finally {
				saveBtn.disabled = false;
				saveBtn.textContent = isEdit ? 'Save Changes' : 'Create';
			}
		});

		// Close on overlay mousedown (not click — click fires after panel hides on dropdown
		// selection, causing a stray event to land on this overlay and tear the drawer down).
		this.formOverlay.addEventListener('mousedown', (ev) => {
			if (ev.target === this.formOverlay) { this._closeForm(); }
		});
	}

	private _closeForm(): void {
		if (this.formOverlay) {
			this._teardownFormListeners();
			this.formOverlay.remove();
			this.formOverlay = null;
		}
		this.editingItem = null;
		this.formSeed = null;
	}

	/** Run and clear the open form's search-field listener teardowns. The dropdown
	 *  DOM is reclaimed with the overlay; this only detaches window listeners. */
	private _teardownFormListeners(): void {
		for (const cleanup of this.formListenerCleanups) {
			try { cleanup(); } catch { /* best-effort */ }
		}
		this.formListenerCleanups = [];
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
		const parentW = this.root.parentElement ? this.root.parentElement.clientWidth : dimension.width;
		if (parentW > 0 && parentW < dimension.width) {
			this.root.style.width = `${parentW}px`;
		}
	}

	override dispose(): void {
		if (this.debounceTimer) { clearTimeout(this.debounceTimer); }
		for (const timer of this.searchDebounceTimers.values()) { clearTimeout(timer); }
		this.searchDebounceTimers.clear();
		this._closeForm();
		super.dispose();
	}
}
