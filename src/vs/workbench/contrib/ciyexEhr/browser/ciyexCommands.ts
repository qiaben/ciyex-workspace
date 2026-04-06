/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * Command: Open Patient Chart
 * Opens a webview panel showing the patient's chart data.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openPatientChart',
			title: localize2('openPatientChart', "Open Patient Chart"),
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, patientId?: string, patientName?: string): Promise<void> {
		if (!patientId) {
			return;
		}

		const label = patientName || `Patient ${patientId}`;
		console.log(`[CiyexEHR] Opening patient chart for ${label} (${patientId})`);
	}
});

/**
 * Command: New Patient
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.newPatient',
			title: localize2('newPatient', "New Patient"),
			f1: true,
			precondition: ContextKeyExpr.has('ciyex.fhir.write.Patient'),
		});
	}

	async run(_accessor: ServicesAccessor): Promise<void> {
		console.log('[CiyexEHR] New Patient command triggered');
	}
});

/**
 * Command: New Appointment
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.newAppointment',
			title: localize2('newAppointment', "New Appointment"),
			f1: true,
			precondition: ContextKeyExpr.has('ciyex.fhir.write.Appointment'),
		});
	}

	async run(_accessor: ServicesAccessor): Promise<void> {
		console.log('[CiyexEHR] New Appointment command triggered');
	}
});

/**
 * Command: Open Calendar
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openCalendar',
			title: localize2('openCalendar', "Open Calendar"),
			f1: true,
			precondition: ContextKeyExpr.has('ciyex.perm.scheduling'),
		});
	}

	async run(_accessor: ServicesAccessor): Promise<void> {
		console.log('[CiyexEHR] Open Calendar command triggered');
	}
});

// Used by future WebviewPanel patient chart editor
export function buildPatientChartHtml(patient: Record<string, unknown>, _apiUrl: string): string {
	const name = `${patient.firstName || ''} ${patient.lastName || ''}`.trim();
	const dob = patient.dateOfBirth as string || '';
	const gender = patient.gender as string || '';
	const phone = patient.phoneNumber as string || '';
	const email = patient.email as string || '';
	const status = patient.status as string || '';

	return `
		<div style="font-family: -apple-system, sans-serif; padding: 20px; color: #ccc;">
			<h2 style="color: #fff; margin: 0 0 16px;">${name}</h2>
			<div style="display: grid; grid-template-columns: 120px 1fr; gap: 8px; font-size: 13px;">
				<span style="color: #858585;">DOB:</span><span>${dob}</span>
				<span style="color: #858585;">Gender:</span><span>${gender}</span>
				<span style="color: #858585;">Phone:</span><span>${phone}</span>
				<span style="color: #858585;">Email:</span><span>${email}</span>
				<span style="color: #858585;">Status:</span><span>${status}</span>
			</div>
		</div>
	`;
}
