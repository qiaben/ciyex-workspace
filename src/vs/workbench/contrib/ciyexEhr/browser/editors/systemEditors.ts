/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { ClinicalListEditorBase, ClinicalEditorConfig, FormFieldDef, showThemedModal, showThemedDetails, IThemedDetailRow } from './clinicalListEditor.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { mainWindow } from '../../../../../base/browser/window.js';

// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────
// PORTAL MANAGEMENT FULL-PAGE EDITORS
// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Document Review Editor — full-page view of portal document reviews (mirrors web app).
 */
export class DocumentReviewEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexDocumentReview';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Document Reviews',
		// Mirror the EHR UI's /document-reviews page which fetches /pending. The
		// deployed backend's collection root (`GET /api/portal/document-reviews`)
		// may not yet be available in older environments and returns
		// "No endpoint GET /api/portal/document-reviews" (HTTP 500); /pending has
		// always been there.
		apiPath: '/api/portal/document-reviews/pending',
		searchPlaceholder: 'Search by patient, document type...',
		clientSideFilter: ['patientName', 'fileName', 'category', 'status', 'id'],
		editable: false,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'fileName', label: 'Document' },
			{ key: 'category', label: 'Category', width: '120px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'createdAt', label: 'Submitted', width: '110px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Accepted', value: 'accepted' },
			{ label: 'Rejected', value: 'rejected' },
		],
		cellRenderer: (key, value) => {
			if (key === 'createdAt' && typeof value === 'string') {
				try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(value); }
			}
			if (key === 'category' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Accept', icon: '\u{2714}', handler: async (item, api, reload, dlg) => {
					if (String(item.status).toLowerCase() !== 'pending') { await dlg.info('Only pending documents can be accepted.'); return; }
					const r = await dlg.confirm({ message: `Accept document from ${item.patientName}?`, type: 'question' });
					if (!r.confirmed) { return; }
					await api.fetch(`/api/portal/document-reviews/${item.id}/accept`, { method: 'PUT' });
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Reject', icon: '\u{2718}', handler: async (item, api, reload, dlg) => {
					if (String(item.status).toLowerCase() !== 'pending') { await dlg.info('Only pending documents can be rejected.'); return; }
					const res = await dlg.input({ type: 'question', message: 'Rejection reason', inputs: [{ placeholder: 'Reason for rejection...' }] });
					if (!res.confirmed) { return; }
					const reason = res.values?.[0]?.trim() || '';
					await api.fetch(`/api/portal/document-reviews/${item.id}/reject?reason=${encodeURIComponent(reason)}`, { method: 'PUT' });
					reload();
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(DocumentReviewEditor.ID, group, t, th, s, a, d); }
}

/**
 * Form Submission Editor — full-page view of portal form submissions (mirrors web app).
 */
export class FormSubmissionEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexFormSubmission';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Form Reviews',
		// Load ALL submissions (the collection root) so the Pending / Accepted /
		// Rejected status tabs — which filter client-side — actually have data to
		// show. Using /pending here meant accepted submissions never appeared
		// under the Accepted tab.
		apiPath: '/api/portal/form-submissions',
		searchPlaceholder: 'Search by patient, form title...',
		clientSideFilter: ['patientName', 'formTitle', 'formKey', 'status', 'id'],
		editable: false,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'formTitle', label: 'Form' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'submittedDate', label: 'Submitted', width: '110px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Accepted', value: 'accepted' },
			{ label: 'Rejected', value: 'rejected' },
		],
		cellRenderer: (key, value) => {
			if (key === 'submittedDate' && typeof value === 'string') {
				try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(value); }
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Accept', icon: '\u{2714}', handler: async (item, api, reload, dlg) => {
					if (String(item.status).toLowerCase() !== 'pending') { await dlg.info('Only pending submissions can be accepted.'); return; }
					const r = await dlg.confirm({ message: `Accept form submission from ${item.patientName}?`, type: 'question' });
					if (!r.confirmed) { return; }
					await api.fetch(`/api/portal/form-submissions/${item.id}/accept`, { method: 'PUT' });
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Reject', icon: '\u{2718}', handler: async (item, api, reload, dlg) => {
					if (String(item.status).toLowerCase() !== 'pending') { await dlg.info('Only pending submissions can be rejected.'); return; }
					const res = await dlg.input({ type: 'question', message: 'Rejection reason', inputs: [{ placeholder: 'Reason for rejection...' }] });
					if (!res.confirmed) { return; }
					const reason = res.values?.[0]?.trim() || '';
					await api.fetch(`/api/portal/form-submissions/${item.id}/reject?reason=${encodeURIComponent(reason)}`, { method: 'PUT' });
					reload();
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(FormSubmissionEditor.ID, group, t, th, s, a, d); }
}

/**
 * Patient Approval Editor — full-page view of pending patient access requests
 * (mirrors web /patient-approvals). Backend at /api/portal/approvals.
 */
export class PatientApprovalEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexPatientApproval';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Patient Approvals',
		// Mirror the EHR UI: /patient-approvals fetches /pending. The collection
		// root isn't guaranteed in older deployed backends.
		apiPath: '/api/portal/approvals/pending',
		searchPlaceholder: 'Search by name, email, DOB...',
		clientSideFilter: ['firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'patientName', 'id'],
		editable: false,
		columns: [
			{ key: 'patientName', label: 'Patient Name' },
			{ key: 'email', label: 'Email' },
			{ key: 'phone', label: 'Phone', width: '120px' },
			{ key: 'dateOfBirth', label: 'Date of Birth', width: '110px' },
			{ key: 'createdAt', label: 'Requested', width: '110px' },
		],
		cellRenderer: (key, value, item) => {
			if (key === 'patientName' && !value) {
				const fn = String(item['firstName'] ?? '');
				const ln = String(item['lastName'] ?? '');
				const full = `${fn} ${ln}`.trim();
				return full || String(item['email'] ?? '');
			}
			if ((key === 'createdAt' || key === 'dateOfBirth') && typeof value === 'string') {
				try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return String(value); }
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Approve', icon: '\u{2714}', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: `Approve access request for ${item.patientName || item.email}?`, type: 'question' });
					if (!r.confirmed) { return; }
					await api.fetch(`/api/portal/approvals/approve/${item.id}`, { method: 'PUT' });
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Reject', icon: '\u{2718}', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({ type: 'question', message: 'Rejection reason', inputs: [{ placeholder: 'Reason for rejection...' }] });
					if (!res.confirmed) { return; }
					const reason = res.values?.[0]?.trim() || 'No reason provided';
					await api.fetch(`/api/portal/approvals/reject/${item.id}?reason=${encodeURIComponent(reason)}`, { method: 'PUT' });
					reload();
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(PatientApprovalEditor.ID, group, t, th, s, a, d); }
}

// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM EDITORS
// allow-any-unicode-next-line
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consents Editor — HIPAA, treatment, research consent management.
 * CRUD with sign/revoke workflows.
 */
export class ConsentsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexConsents';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Consents',
		apiPath: '/api/consents',
		statsPath: '/api/consents/stats',
		searchPlaceholder: 'Search by patient name, consent type...',
		clientSideFilter: ['patientName', 'consentType', 'status', 'signedBy', 'id'],
		editable: true,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'consentType', label: 'Type', width: '120px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'signedDate', label: 'Signed Date', width: '100px' },
			{ key: 'expiryDate', label: 'Expiry Date', width: '100px' },
			{ key: 'signedBy', label: 'Signed By', width: '120px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Signed', value: 'signed' },
			{ label: 'Expired', value: 'expired' },
			{ label: 'Revoked', value: 'revoked' },
		],
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', searchDisplayField: 'name', searchValueField: 'id', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{
				key: 'consentType', label: 'Consent Type', type: 'select', required: true, options: [
					{ label: 'HIPAA Privacy', value: 'hipaa_privacy' },
					{ label: 'Treatment', value: 'treatment' },
					{ label: 'Release of Info', value: 'release_of_info' },
					{ label: 'Telehealth', value: 'telehealth' },
					{ label: 'Research', value: 'research' },
					{ label: 'Financial', value: 'financial' },
				]
			},
			{
				key: 'status', label: 'Status', type: 'select', options: [
					{ label: 'Pending', value: 'pending' },
					{ label: 'Signed', value: 'signed' },
					{ label: 'Expired', value: 'expired' },
					{ label: 'Revoked', value: 'revoked' },
				], defaultValue: 'pending'
			},
			{ key: 'expiryDate', label: 'Expiry Date', type: 'date' },
			{ key: 'version', label: 'Version', type: 'text', placeholder: '1.0' },
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
		],
		cellRenderer: (key, value) => {
			if (key === 'consentType' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Sign', icon: '✍️', handler: async (item, api, reload, dlg) => {
					if (item.status !== 'pending') { return; }
					// Themed "Sign Consent" modal mirroring ehr-ui app/consents/page.tsx
					// SignModal: "Signed By *" (required) + "Witness Name" (optional),
					// Cancel / Sign buttons — replaces the bare dialog prompt.
					const result = await showThemedModal({
						title: 'Sign Consent',
						fields: [
							{ key: 'signedBy', label: 'Signed By', type: 'text', required: true, placeholder: 'Patient or guardian name' },
							{ key: 'witnessName', label: 'Witness Name', type: 'text', placeholder: 'Witness name (optional)' },
						],
						confirmLabel: 'Sign',
					});
					const signedBy = result?.['signedBy']?.trim();
					const witnessName = result?.['witnessName']?.trim() || '';
					if (signedBy) {
						const r = await api.fetch(`/api/consents/${item.id}/sign`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ signedBy, witnessName }),
						});
						if (!r.ok) {
							const err = await r.json().catch(() => ({}));
							await dlg.error(String(err?.['message'] || `Failed to sign consent (HTTP ${r.status}).`));
							return;
						}
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Revoke', icon: '🚫', handler: async (item, api, reload, dlg) => {
					if (item.status !== 'signed') { return; }
					const r = await dlg.confirm({ message: `Revoke consent for ${item.patientName}?`, type: 'warning', primaryButton: 'Revoke' });
					if (r.confirmed) {
						await api.fetch(`/api/consents/${item.id}/revoke`, { method: 'POST' });
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: 'Delete this consent?', type: 'warning', primaryButton: 'Delete' });
					if (r.confirmed) {
						await api.fetch(`/api/consents/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(ConsentsEditor.ID, group, t, th, s, a, d); }
}


// NotificationsEditor moved to notificationsEditor.ts (custom 5-tab editor)


/**
 * Fax Editor — Inbound/outbound fax queue management.
 */
export const FAX_FORM_FIELDS: FormFieldDef[] = [
	{ key: 'recipientName', label: 'Recipient Name', type: 'search', required: true, placeholder: 'Search recipient...', apiPath: '/api/providers', searchDisplayField: 'name', searchValueField: 'id', relatedDisplayFields: ['firstName', 'lastName'] },
	// Fax number must be a 10-digit US number, with an optional leading "1"/"+1"
	// country code (so 10 or 11 digits total). The pattern allows the usual
	// spaces / parens / dashes / dots as separators. (Previously required
	// exactly 12 digits, which rejected the standard 10/11-digit format — even
	// its own "+1 555 123 4567" example, which is 11 digits.)
	{ key: 'faxNumber', label: 'Fax Number', type: 'text', required: true, placeholder: 'e.g. (555) 123-4567 or +1 555 123 4567', maxDigits: 11, validationPattern: '^\\+?1?[\\s().-]*(?:[\\s().-]*\\d){10}[\\s().-]*$', validationMessage: 'Fax number must be a 10-digit US number (optionally with a +1 country code)' },
	{ key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Fax subject' },
	{ key: 'pageCount', label: 'Page Count', type: 'number', placeholder: '1' },
	{ key: 'patientName', label: 'Patient Name', type: 'search', placeholder: 'Search patient...', apiPath: '/api/patients', searchDisplayField: 'name', searchValueField: 'id', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
	{ key: 'patientId', label: 'Patient ID', type: 'text', placeholder: 'Auto-filled from patient search' },
	{
		key: 'category', label: 'Category', type: 'select', options: [
			{ label: 'Referral', value: 'referral' },
			{ label: 'Lab Result', value: 'lab_result' },
			{ label: 'Prior Auth', value: 'prior_auth' },
			{ label: 'Medical Records', value: 'medical_records' },
			{ label: 'Other', value: 'other' },
		]
	},
	// Status select — mirrors ehr-ui FaxFormPanel.tsx outbound statuses
	// (Pending/Sending/Sent/Delivered/Failed) for new (outbound) faxes.
	{
		key: 'status', label: 'Status', type: 'select', defaultValue: 'pending', options: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Sending', value: 'sending' },
			{ label: 'Sent', value: 'sent' },
			{ label: 'Delivered', value: 'delivered' },
			{ label: 'Failed', value: 'failed' },
			{ label: 'Received', value: 'received' },
		]
	},
	{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
];

export class FaxEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexFax';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Fax Messages',
		apiPath: '/api/fax',
		statsPath: '/api/fax/stats',
		searchPlaceholder: 'Search by sender, recipient, subject...',
		clientSideFilter: ['direction', 'faxNumber', 'senderName', 'recipientName', 'subject', 'category', 'status', 'patientName', 'id'],
		editable: true,
		// Mirrors ciyex-ehr-ui FaxTable.tsx columns: From/To | Fax Number | Subject
		// | Pages | Category | Patient | Status | Date (Actions auto-rendered).
		columns: [
			{ key: 'contact', label: 'From / To', width: '1fr' },
			{ key: 'faxNumber', label: 'Fax Number', width: '130px' },
			{ key: 'subject', label: 'Subject', width: '1.3fr' },
			{ key: 'pageCount', label: 'Pages', width: '60px' },
			{ key: 'category', label: 'Category', width: '110px' },
			{ key: 'patientName', label: 'Patient', width: '120px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'date', label: 'Date', width: '140px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Sending', value: 'sending' },
			{ label: 'Sent', value: 'sent' },
			{ label: 'Delivered', value: 'delivered' },
			{ label: 'Failed', value: 'failed' },
			{ label: 'Received', value: 'received' },
		],
		additionalFilters: [
			{
				key: 'direction', placeholder: 'All Directions',
				options: [
					{ label: 'Inbound', value: 'inbound' },
					{ label: 'Outbound', value: 'outbound' },
				],
			},
			{
				key: 'category', placeholder: 'All Categories',
				options: [
					{ label: 'Referral', value: 'referral' },
					{ label: 'Lab Result', value: 'lab_result' },
					{ label: 'Prior Auth', value: 'prior_auth' },
					{ label: 'Medical Records', value: 'medical_records' },
					{ label: 'Other', value: 'other' },
				],
			},
		],
		formFields: FAX_FORM_FIELDS,
		cellRenderer: (key, value, item) => {
			// Derived columns: From/To shows senderName for inbound faxes and
			// recipientName for outbound (matching FaxTable.tsx). Date pulls
			// receivedAt for inbound or sentAt/createdAt for outbound.
			if (key === 'contact') {
				const dir = String(item['direction'] || '').toLowerCase();
				const fallback = item['senderName'] || item['recipientName'] || '';
				const name = dir === 'inbound' ? (item['senderName'] || fallback) : (item['recipientName'] || fallback);
				// allow-any-unicode-next-line
				const arrow = dir === 'inbound' ? '📥' : '📤';
				return `${arrow} ${String(name || '—')}`;
			}
			if (key === 'date') {
				const dir = String(item['direction'] || '').toLowerCase();
				const raw = dir === 'inbound'
					? (item['receivedAt'] || item['createdAt'])
					: (item['sentAt'] || item['createdAt']);
				if (!raw) { return '—'; }
				try { return new Date(String(raw)).toLocaleString(); } catch { return String(raw); }
			}
			if (key === 'category' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		actions: [
			{
				// View action — mirrors ehr-ui FaxTable.tsx "View details" (Eye) button.
				// Read-only fax detail summary; the "Assign to Patient" action was
				// removed (issue #17c) but the View option is kept.
				// allow-any-unicode-next-line
				label: 'View', icon: '\u{1F441}', handler: async (item, _api, _reload, _dlg) => {
					const dash = '\u2014';
					const dir = String(item['direction'] || '').toLowerCase();
					const contact = dir === 'inbound'
						? (item['senderName'] || item['recipientName'] || dash)
						: (item['recipientName'] || item['senderName'] || dash);
					const cap = (s: string): string => s ? s.charAt(0).toUpperCase() + s.slice(1) : dash;
					const fmtDate = (raw: unknown): string => {
						if (!raw) { return dash; }
						try { return new Date(String(raw)).toLocaleString(); } catch { return String(raw); }
					};
					const statusColors: Record<string, string> = {
						pending: '#f59e0b', sending: '#3b82f6', sent: '#3b82f6',
						delivered: '#22c55e', received: '#22c55e', failed: '#ef4444',
						processed: '#22c55e', attached: '#22c55e', cancelled: '#9ca3af',
					};
					const status = String(item['status'] || '').toLowerCase();
					const category = String(item['category'] || '');
					const rows: IThemedDetailRow[] = [
						{ label: 'Direction', value: cap(dir) },
						{ label: 'Status', value: status ? cap(status) : dash, accent: statusColors[status] },
						{ label: dir === 'inbound' ? 'From' : 'To', value: String(contact) },
						{ label: 'Fax Number', value: String(item['faxNumber'] || dash) },
						{ label: 'Subject', value: String(item['subject'] || dash) },
						{ label: 'Pages', value: String(item['pageCount'] ?? dash) },
						{ label: 'Category', value: category ? category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : dash },
						{ label: 'Patient', value: String(item['patientName'] || dash) },
						{ label: 'Processed By', value: String(item['processedBy'] || dash) },
						{ label: 'Processed At', value: fmtDate(item['processedAt']) },
						{ label: 'Received', value: fmtDate(item['receivedAt']) },
						{ label: 'Sent', value: fmtDate(item['sentAt']) },
					];
					if (item['notes']) {
						rows.push({ label: 'Notes', value: String(item['notes']), wide: true });
					}
					await showThemedDetails({ title: 'Fax Details', subtitle: String(item['subject'] || ''), rows });
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Mark Processed', icon: '✅', handler: async (item, api, reload, dlg) => {
					// Backend requires the acting user in the body (processedBy is
					// mandatory — a bodyless POST is rejected with HTTP 400).
					const processedBy = (typeof localStorage !== 'undefined' ? localStorage.getItem('ciyex_email') : '') || 'unknown';
					const res = await api.fetch(`/api/fax/${item.id}/process`, {
						method: 'POST',
						body: JSON.stringify({ processedBy }),
					});
					if (!res.ok) {
						await dlg.error(localize('faxProcessFailed', "Failed to mark fax as processed ({0}).", res.status));
						return;
					}
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: 'Delete this fax?', type: 'warning', primaryButton: 'Delete' });
					if (r.confirmed) {
						await api.fetch(`/api/fax/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(FaxEditor.ID, group, t, th, s, a, d); }
}



// DocScanningEditor moved to documentScanningEditor.ts (custom upload + OCR EditorPane).
export { DocScanningEditor } from './documentScanningEditor.js';


// KioskEditor moved to kioskEditor.ts (custom Config + Log dual-tab editor)


/**
 * Audit Log Editor — System activity and compliance audit trail.
 * Read-only view with filtering.
 */
export class AuditLogEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexAuditLog';
	private readonly _patientNameCache = new Map<string, string>();
	protected readonly config: ClinicalEditorConfig = {
		title: 'Audit Log',
		apiPath: '/api/audit-log',
		statsPath: '/api/audit-log/stats',
		searchPlaceholder: 'Search by user, resource, patient...',
		clientSideFilter: ['action', 'resourceType', 'resourceName', 'userName', 'userRole', 'patientName', 'ipAddress', 'id'],
		editable: false,
		filterKey: 'action',
		// Columns ordered to match ciyex-ehr-ui: Timestamp, User, Role, Action, Resource Type, Resource, Patient, IP, Details
		columns: [
			{ key: 'createdAt', label: 'Timestamp', width: '130px' },
			{ key: 'userName', label: 'User' },
			{ key: 'userRole', label: 'Role', width: '80px' },
			{ key: 'action', label: 'Action', width: '80px' },
			{ key: 'resourceType', label: 'Resource Type', width: '120px' },
			{ key: 'resourceName', label: 'Resource' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'ipAddress', label: 'IP Address', width: '110px' },
			{ key: 'details', label: 'Details', width: '120px' },
		],
		statusTabs: [
			{ label: 'View', value: 'VIEW' },
			{ label: 'Create', value: 'CREATE' },
			{ label: 'Update', value: 'UPDATE' },
			{ label: 'Delete', value: 'DELETE' },
			{ label: 'Sign', value: 'SIGN' },
			{ label: 'Print', value: 'PRINT' },
			{ label: 'Export', value: 'EXPORT' },
		],
		additionalFilters: [
			{
				key: 'resourceType', placeholder: 'All Resource Types',
				options: [
					{ label: 'Patient', value: 'Patient' },
					{ label: 'Appointment', value: 'Appointment' },
					{ label: 'Prescription', value: 'Prescription' },
					{ label: 'Lab Order', value: 'LabOrder' },
					{ label: 'Document', value: 'Document' },
					{ label: 'User', value: 'User' },
					{ label: 'Consent', value: 'Consent' },
					{ label: 'Encounter', value: 'Encounter' },
					{ label: 'Billing', value: 'Billing' },
				],
			},
		],
		cellRenderer: (key, value, item) => {
			if (key === 'patientName') {
				if (value) { return String(value); }
				// When the audited resource is itself a Patient, the resource name IS
				// the patient — show it so the column isn't blank for those rows.
				if (String(item.resourceType || '').toLowerCase() === 'patient' && item.resourceName) {
					return String(item.resourceName);
				}
				// enrichItems resolves patientId → name asynchronously; until then
				// (or when no patient is involved) leave the cell empty.
				return '';
			}
			if (key === 'createdAt' && typeof value === 'string') {
				try { return new Date(value).toLocaleString(); } catch { return String(value); }
			}
			if (key === 'action' && typeof value === 'string') {
				return value.toUpperCase();
			}
			if (key === 'details') {
				if (!value) { return '—'; }
				if (typeof value === 'object') {
					try { return JSON.stringify(value).slice(0, 60); } catch { return '—'; }
				}
				const s = String(value);
				return s.length > 60 ? s.slice(0, 60) + '…' : s;
			}
			return String(value ?? '');
		},
		// The Patient column was always blank: audit records carry a patientId (or
		// nest it in `details`) but no patientName. Resolve the names from
		// /api/patients/{id} (cached) so the column is populated.
		enrichItems: async (items) => {
			const patientIdOf = (it: Record<string, unknown>): string => {
				const direct = it['patientId'] ?? it['patient_id'] ?? it['patientID'];
				if (direct !== undefined && direct !== null && direct !== '' && String(direct) !== 'null') { return String(direct); }
				// `details` is usually a JSON STRING ({"method":...,"patientId":13864}),
				// so parse it before reading the nested patient id.
				let d = it['details'];
				if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = undefined; } }
				if (d && typeof d === 'object') {
					const dd = d as Record<string, unknown>;
					const nested = dd['patientId'] ?? dd['patient_id'] ?? dd['patientID'];
					if (nested !== undefined && nested !== null && nested !== '' && String(nested) !== 'null') { return String(nested); }
				}
				return '';
			};
			const missing = Array.from(new Set(items
				.filter(it => !it['patientName'])
				.map(patientIdOf)
				.filter(pid => pid && !this._patientNameCache.has(pid))));
			await Promise.all(missing.map(async pid => {
				try {
					const res = await this.apiService.fetch(`/api/patients/${encodeURIComponent(pid)}`);
					if (!res.ok) { return; }
					const data = await res.json();
					const p = data?.data || data;
					const first = p?.firstName || p?.identification?.firstName || '';
					const last = p?.lastName || p?.identification?.lastName || '';
					const full = `${first} ${last}`.trim();
					if (full) { this._patientNameCache.set(pid, full); }
				} catch { /* leave blank */ }
			}));
			for (const it of items) {
				if (it['patientName']) { continue; }
				const name = this._patientNameCache.get(patientIdOf(it));
				if (name) { it['patientName'] = name; }
			}
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Export CSV', icon: '📥', handler: async (_item, api, _reload, _dlg) => {
					// Fetch all audit log entries and export as a downloadable CSV file
					const cols = ['createdAt', 'userName', 'userRole', 'action', 'resourceType', 'resourceName', 'patientName', 'ipAddress', 'details'];
					const headers = ['Timestamp', 'User', 'Role', 'Action', 'Resource Type', 'Resource', 'Patient', 'IP Address', 'Details'];
					let allItems: Record<string, unknown>[] = [];
					try {
						const res = await api.fetch('/api/audit-log?page=0&size=500');
						if (res.ok) {
							const d = await res.json();
							const w = d?.data || d;
							allItems = w?.content || (Array.isArray(w) ? w : []);
						}
					} catch { /* use empty set */ }
					const escape = (v: unknown) => {
						const s = String(v ?? '');
						return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
					};
					const csv = [headers.join(','), ...allItems.map(row => cols.map(c => escape(row[c])).join(','))].join('\n');
					const blob = new Blob([csv], { type: 'text/csv' });
					const url = URL.createObjectURL(blob);
					const a = mainWindow.document.createElement('a');
					a.href = url;
					a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
					mainWindow.document.body.appendChild(a);
					a.click();
					setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(AuditLogEditor.ID, group, t, th, s, a, d); }
}
