/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClinicalListEditorBase, ClinicalEditorConfig } from './clinicalListEditor.js';
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
		// Use the collection root; the backend now supports GET /api/portal/document-reviews.
		// Client-side filtering on `status` handles the Pending/Accepted/Rejected tabs.
		apiPath: '/api/portal/document-reviews',
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
		// Use the collection root for full list; status tabs filter client-side.
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
		// Use the collection root; client-side filtering handles status tabs.
		apiPath: '/api/portal/approvals',
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
					const res = await dlg.input({
						type: 'question', message: 'Sign consent',
						inputs: [
							{ placeholder: 'Signed by (patient or guardian name)' },
							{ placeholder: 'Witness name (optional)' },
						],
					});
					if (!res.confirmed) { return; }
					const signedBy = res.values?.[0]?.trim();
					const witnessName = res.values?.[1]?.trim() || '';
					if (signedBy) {
						await api.fetch(`/api/consents/${item.id}/sign`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ signedBy, witnessName }),
						});
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
export class FaxEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexFax';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Fax Messages',
		apiPath: '/api/fax',
		statsPath: '/api/fax/stats',
		searchPlaceholder: 'Search by sender, recipient, subject...',
		clientSideFilter: ['direction', 'faxNumber', 'senderName', 'recipientName', 'subject', 'category', 'status', 'patientName', 'id'],
		editable: true,
		columns: [
			{ key: 'direction', label: 'Direction', width: '80px' },
			{ key: 'faxNumber', label: 'Fax Number', width: '120px' },
			{ key: 'senderName', label: 'Sender', width: '1fr' },
			{ key: 'recipientName', label: 'Recipient', width: '1fr' },
			{ key: 'subject', label: 'Subject', width: '1.3fr' },
			{ key: 'pageCount', label: 'Pages', width: '55px' },
			{ key: 'category', label: 'Category', width: '100px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'sentAt', label: 'Sent At', width: '130px' },
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
		formFields: [
			{ key: 'recipientName', label: 'Recipient Name', type: 'search', required: true, placeholder: 'Search recipient...', apiPath: '/api/providers', searchDisplayField: 'name', searchValueField: 'id', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'faxNumber', label: 'Fax Number', type: 'text', required: true, placeholder: '+1-555-555-5555' },
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
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes...' },
		],
		cellRenderer: (key, value) => {
			if (key === 'direction' && typeof value === 'string') {
				// allow-any-unicode-next-line
				return value === 'inbound' ? '📥 Inbound' : '📤 Outbound';
			}
			if (key === 'category' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'sentAt' && typeof value === 'string') {
				try { return new Date(value).toLocaleString(); } catch { return String(value); }
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Assign to Patient', icon: '👤', handler: async (item, api, reload, dlg) => {
					const res = await dlg.input({
						type: 'question', message: 'Assign fax to patient',
						inputs: [
							{ placeholder: 'Patient ID' },
							{ placeholder: 'Patient Name' },
						],
					});
					if (!res.confirmed) { return; }
					const patientId = res.values?.[0]?.trim();
					const patientName = res.values?.[1]?.trim();
					if (patientId && patientName) {
						await api.fetch(`/api/fax/${item.id}/assign`, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ patientId, patientName }),
						});
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Mark Processed', icon: '✅', handler: async (item, api, reload) => {
					await api.fetch(`/api/fax/${item.id}/process`, { method: 'POST' });
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


/**
 * Document Scanning Editor — OCR upload, processing, and management.
 */
export class DocScanningEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexDocScanning';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Document Scanning',
		// Backend exposes /api/document-scanning (DocumentScanningController). The
		// previous /api/documents path is a different controller (uploads only) and
		// returned 500 on list. Aligns with ciyex-ehr-ui document-scanning page.
		apiPath: '/api/document-scanning',
		statsPath: '/api/document-scanning/stats',
		searchPlaceholder: 'Search by file name, patient...',
		clientSideFilter: ['fileName', 'patientName', 'category', 'mimeType', 'ocrStatus', 'id'],
		editable: true,
		filterKey: 'ocrStatus',
		columns: [
			{ key: 'fileName', label: 'Document', width: '1.5fr' },
			{ key: 'category', label: 'Category', width: '110px' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'ocrStatus', label: 'OCR Status', width: '100px' },
			{ key: 'fileSize', label: 'Size', width: '75px' },
			{ key: 'createdAt', label: 'Uploaded', width: '130px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Processing', value: 'processing' },
			{ label: 'Completed', value: 'completed' },
			{ label: 'Failed', value: 'failed' },
		],
		additionalFilters: [
			{
				key: 'category', placeholder: 'All Categories',
				options: [
					{ label: 'Medical Record', value: 'medical_record' },
					{ label: 'Insurance', value: 'insurance' },
					{ label: 'Legal', value: 'legal' },
					{ label: 'Lab Report', value: 'lab_report' },
					{ label: 'Imaging', value: 'imaging' },
					{ label: 'Insurance Card', value: 'insurance_card' },
					{ label: 'Consent Form', value: 'consent_form' },
					{ label: 'Referral', value: 'referral' },
					{ label: 'Discharge Summary', value: 'discharge_summary' },
					{ label: 'Other', value: 'other' },
				],
			},
		],
		formFields: [
			{ key: 'fileName', label: 'File Name', type: 'text', required: true, placeholder: 'Document file name' },
			{ key: 'patientName', label: 'Patient Name', type: 'search', required: true, placeholder: 'Search patient...', apiPath: '/api/patients', searchDisplayField: 'name', searchValueField: 'id', relatedField: 'patientId', relatedDisplayFields: ['firstName', 'lastName'] },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Auto-filled from patient search' },
			{
				key: 'category', label: 'Category', type: 'select', required: true, options: [
					{ label: 'Lab Report', value: 'lab_report' },
					{ label: 'Imaging', value: 'imaging' },
					{ label: 'Insurance Card', value: 'insurance_card' },
					{ label: 'Consent Form', value: 'consent_form' },
					{ label: 'Referral', value: 'referral' },
					{ label: 'Discharge Summary', value: 'discharge_summary' },
					{ label: 'Other', value: 'other' },
				]
			},
			{ key: 'notes', label: 'Notes', type: 'textarea', placeholder: 'Additional notes about this document...' },
		],
		cellRenderer: (key, value) => {
			if (key === 'category' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'ocrStatus' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			if (key === 'ocrConfidence' && typeof value === 'number') {
				return `${Math.round(value * 100)}%`;
			}
			if (key === 'createdAt' && typeof value === 'string') {
				try { return new Date(value).toLocaleString(); } catch { return String(value); }
			}
			if (key === 'fileSize') {
				const bytes = Number(value);
				if (!bytes || isNaN(bytes)) { return '—'; }
				if (bytes < 1024) { return `${bytes} B`; }
				if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
				return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
			}
			if (key === 'mimeType' && typeof value === 'string') {
				return value.replace('application/', '').replace('image/', '').toUpperCase();
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Re-OCR', icon: '🔄', handler: async (item, api, reload) => {
					await api.fetch(`/api/document-scanning/${item.id}/ocr`, { method: 'POST' });
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload, dlg) => {
					const r = await dlg.confirm({ message: `Delete ${item.fileName}?`, type: 'warning', primaryButton: 'Delete' });
					if (r.confirmed) {
						await api.fetch(`/api/document-scanning/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService, @IDialogService d: IDialogService) { super(DocScanningEditor.ID, group, t, th, s, a, d); }
}


// KioskEditor moved to kioskEditor.ts (custom Config + Log dual-tab editor)


/**
 * Audit Log Editor — System activity and compliance audit trail.
 * Read-only view with filtering.
 */
export class AuditLogEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexAuditLog';
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
		cellRenderer: (key, value) => {
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
