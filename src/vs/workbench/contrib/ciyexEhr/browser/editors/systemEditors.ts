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
		editable: true,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'consentType', label: 'Type', width: '120px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'signedDate', label: 'Signed Date', width: '100px' },
			{ key: 'expiryDate', label: 'Expiry Date', width: '100px' },
			{ key: 'signedBy', label: 'Signed By', width: '120px' },
			{ key: 'version', label: 'Version', width: '60px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Signed', value: 'signed' },
			{ label: 'Expired', value: 'expired' },
			{ label: 'Revoked', value: 'revoked' },
		],
		formFields: [
			{ key: 'patientName', label: 'Patient Name', type: 'text', required: true, placeholder: 'Patient name' },
			{ key: 'patientId', label: 'Patient ID', type: 'text', required: true, placeholder: 'Patient ID' },
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
				label: 'Sign', icon: '✍️', handler: async (item, api, reload) => {
					if (item.status !== 'pending') { return; }
					const signedBy = prompt('Signed by (patient or guardian name):');
					if (signedBy) {
						const witnessName = prompt('Witness name (optional):') || '';
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
				label: 'Revoke', icon: '🚫', handler: async (item, api, reload) => {
					if (item.status !== 'signed') { return; }
					if (confirm(`Revoke consent for ${item.patientName}?`)) {
						await api.fetch(`/api/consents/${item.id}/revoke`, { method: 'POST' });
						reload();
					}
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => {
					if (confirm('Delete this consent?')) {
						await api.fetch(`/api/consents/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(ConsentsEditor.ID, group, t, th, s, a); }
}


/**
 * Notifications Editor — Notification log, retry, and delivery tracking.
 */
export class NotificationsEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexNotifications';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Notifications',
		apiPath: '/api/notifications/log',
		statsPath: '/api/notifications/log/stats',
		searchPlaceholder: 'Search by recipient, subject...',
		editable: false,
		columns: [
			{ key: 'channelType', label: 'Channel', width: '80px' },
			{ key: 'recipientName', label: 'Recipient' },
			{ key: 'recipient', label: 'Address' },
			{ key: 'subject', label: 'Subject', width: '1.5fr' },
			{ key: 'triggerType', label: 'Trigger', width: '80px' },
			{ key: 'status', label: 'Status', width: '90px' },
			{ key: 'sentAt', label: 'Sent At', width: '130px' },
		],
		statusTabs: [
			{ label: 'Queued', value: 'queued' },
			{ label: 'Sent', value: 'sent' },
			{ label: 'Delivered', value: 'delivered' },
			{ label: 'Failed', value: 'failed' },
			{ label: 'Bounced', value: 'bounced' },
		],
		cellRenderer: (key, value) => {
			if (key === 'channelType' && typeof value === 'string') {
				return value.toUpperCase();
			}
			if (key === 'triggerType' && typeof value === 'string') {
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
				label: 'Retry', icon: '🔄', handler: async (item, api, reload) => {
					if (item.status !== 'failed' && item.status !== 'bounced') { return; }
					await api.fetch(`/api/notifications/${item.id}/retry`, { method: 'POST' });
					reload();
				}
			},
			{
				// allow-any-unicode-next-line
				label: 'Resend', icon: '📤', handler: async (item, api, reload) => {
					if (confirm(`Resend notification to ${item.recipientName || item.recipient}?`)) {
						await api.fetch(`/api/notifications/resend/${item.id}`, { method: 'POST' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(NotificationsEditor.ID, group, t, th, s, a); }
}


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
		editable: true,
		columns: [
			{ key: 'direction', label: 'Direction', width: '80px' },
			{ key: 'faxNumber', label: 'Fax Number', width: '110px' },
			{ key: 'senderName', label: 'Sender' },
			{ key: 'recipientName', label: 'Recipient' },
			{ key: 'subject', label: 'Subject', width: '1.3fr' },
			{ key: 'pageCount', label: 'Pages', width: '55px' },
			{ key: 'category', label: 'Category', width: '100px' },
			{ key: 'status', label: 'Status', width: '90px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Sending', value: 'sending' },
			{ label: 'Sent', value: 'sent' },
			{ label: 'Delivered', value: 'delivered' },
			{ label: 'Failed', value: 'failed' },
			{ label: 'Received', value: 'received' },
		],
		formFields: [
			{ key: 'recipientName', label: 'Recipient Name', type: 'text', required: true, placeholder: 'Recipient name' },
			{ key: 'faxNumber', label: 'Fax Number', type: 'text', required: true, placeholder: '+1-555-555-5555' },
			{ key: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'Fax subject' },
			{ key: 'pageCount', label: 'Page Count', type: 'number', placeholder: '1' },
			{ key: 'patientName', label: 'Patient Name', type: 'text', placeholder: 'Linked patient (optional)' },
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
				return value === 'inbound' ? 'Inbound' : 'Outbound';
			}
			if (key === 'category' && typeof value === 'string') {
				return value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
			}
			return String(value ?? '');
		},
		actions: [
			{
				// allow-any-unicode-next-line
				label: 'Assign to Patient', icon: '👤', handler: async (item, api, reload) => {
					const patientId = prompt('Enter Patient ID:');
					const patientName = prompt('Enter Patient Name:');
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
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => {
					if (confirm('Delete this fax?')) {
						await api.fetch(`/api/fax/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(FaxEditor.ID, group, t, th, s, a); }
}


/**
 * Document Scanning Editor — OCR upload, processing, and management.
 */
export class DocScanningEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexDocScanning';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Document Scanning',
		apiPath: '/api/document-scanning',
		searchPlaceholder: 'Search by file name, patient...',
		editable: false,
		columns: [
			{ key: 'fileName', label: 'File Name', width: '1.5fr' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'category', label: 'Category', width: '110px' },
			{ key: 'mimeType', label: 'Type', width: '90px' },
			{ key: 'ocrStatus', label: 'OCR Status', width: '100px' },
			{ key: 'ocrConfidence', label: 'Confidence', width: '80px' },
			{ key: 'createdAt', label: 'Uploaded', width: '130px' },
		],
		statusTabs: [
			{ label: 'Pending', value: 'pending' },
			{ label: 'Processing', value: 'processing' },
			{ label: 'Completed', value: 'completed' },
			{ label: 'Failed', value: 'failed' },
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
				label: 'Delete', icon: '🗑️', handler: async (item, api, reload) => {
					if (confirm(`Delete ${item.fileName}?`)) {
						await api.fetch(`/api/document-scanning/${item.id}`, { method: 'DELETE' });
						reload();
					}
				}
			},
		],
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(DocScanningEditor.ID, group, t, th, s, a); }
}


/**
 * Kiosk Editor — Check-in kiosk log viewer.
 * Shows today's check-ins and their completion status.
 */
export class KioskEditor extends ClinicalListEditorBase {
	static readonly ID = 'workbench.editor.ciyexKiosk';
	protected readonly config: ClinicalEditorConfig = {
		title: 'Check-in Kiosk',
		apiPath: '/api/kiosk/checkins',
		statsPath: '/api/kiosk/stats',
		searchPlaceholder: 'Search by patient name...',
		editable: false,
		columns: [
			{ key: 'patientName', label: 'Patient' },
			{ key: 'checkInTime', label: 'Check-in Time', width: '130px' },
			{ key: 'verificationMethod', label: 'Verified By', width: '100px' },
			{ key: 'demographicsUpdated', label: 'Demographics', width: '100px' },
			{ key: 'insuranceUpdated', label: 'Insurance', width: '90px' },
			{ key: 'consentSigned', label: 'Consent', width: '80px' },
			{ key: 'copayCollected', label: 'Copay', width: '80px' },
			{ key: 'copayAmount', label: 'Amount', width: '70px' },
		],
		cellRenderer: (key, value) => {
			if (key === 'checkInTime' && typeof value === 'string') {
				try { return new Date(value).toLocaleString(); } catch { return String(value); }
			}
			if (key === 'verificationMethod' && typeof value === 'string') {
				return value.toUpperCase();
			}
			if (typeof value === 'boolean') {
				// allow-any-unicode-next-line
				return value ? '✓ Yes' : '✗ No';
			}
			if (key === 'copayAmount' && typeof value === 'number') {
				return `$${value.toFixed(2)}`;
			}
			return String(value ?? '');
		},
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(KioskEditor.ID, group, t, th, s, a); }
}


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
		editable: false,
		columns: [
			{ key: 'action', label: 'Action', width: '80px' },
			{ key: 'resourceType', label: 'Resource Type', width: '120px' },
			{ key: 'resourceName', label: 'Resource' },
			{ key: 'userName', label: 'User' },
			{ key: 'userRole', label: 'Role', width: '90px' },
			{ key: 'patientName', label: 'Patient' },
			{ key: 'ipAddress', label: 'IP Address', width: '110px' },
			{ key: 'createdAt', label: 'Time', width: '130px' },
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
		cellRenderer: (key, value) => {
			if (key === 'createdAt' && typeof value === 'string') {
				try { return new Date(value).toLocaleString(); } catch { return String(value); }
			}
			if (key === 'action' && typeof value === 'string') {
				return value.toUpperCase();
			}
			return String(value ?? '');
		},
	};
	constructor(group: IEditorGroup, @ITelemetryService t: ITelemetryService, @IThemeService th: IThemeService, @IStorageService s: IStorageService, @ICiyexApiService a: ICiyexApiService) { super(AuditLogEditor.ID, group, t, th, s, a); }
}
