/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICiyexApiService } from './ciyexApiService.js';

/** Best-effort patient id for an appointment row, across the assorted shapes
 *  the backend returns (flat `patientId`, a FHIR `Patient/<id>` reference on
 *  `patient`/`subject`, or a `participant[].actor.reference`). Used to detect
 *  duplicate same-day bookings for a patient. */
export function resolveApptPatientId(apt: Record<string, unknown>): string {
	if (apt.patientId !== undefined && apt.patientId !== null && apt.patientId !== '') { return String(apt.patientId); }
	const refId = (val: unknown): string => {
		const m = typeof val === 'string' ? val.match(/Patient\/(\S+)/) : null;
		return m ? m[1] : '';
	};
	for (const candidate of [apt.patient, (apt.patient as { reference?: string } | undefined)?.reference, (apt.subject as { reference?: string } | undefined)?.reference]) {
		const id = refId(candidate);
		if (id) { return id; }
	}
	const participants = apt.participant as Array<{ actor?: { reference?: string } }> | undefined;
	if (Array.isArray(participants)) {
		for (const p of participants) {
			const id = refId(p.actor?.reference);
			if (id) { return id; }
		}
	}
	return '';
}

export function localDateStr(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse an appointment row's start date/time robustly — handles ISO, epoch,
 *  date-only, and time-only shapes across the backend's assorted responses. */
export function parseApptDate(apt: Record<string, unknown>): Date | null {
	const raw = apt.start ?? apt.startTime;
	if (!raw) { return null; }
	if (typeof raw === 'number' || /^\d{10,13}$/.test(String(raw))) {
		const ms = typeof raw === 'number' ? raw : (String(raw).length <= 10 ? Number(raw) * 1000 : Number(raw));
		const d = new Date(ms);
		return isNaN(d.getTime()) ? null : d;
	}
	const d = new Date(String(raw));
	if (!isNaN(d.getTime())) { return d; }
	if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
		const d2 = new Date(`${raw}T00:00:00`);
		return isNaN(d2.getTime()) ? null : d2;
	}
	return null;
}

/** True when `patientId`/`patientName` already has a non-cancelled appointment
 *  on `date` (YYYY-MM-DD) — enforces "one appointment per patient per day".
 *  Queries the server (rather than relying on already-loaded rows) so the
 *  rule holds even for dates outside the currently loaded range; cancelled
 *  appointments don't count, so a patient can be re-booked after one. */
export async function hasDuplicateAppointment(
	apiService: ICiyexApiService,
	date: string,
	patientId: string,
	patientName: string,
): Promise<boolean> {
	const dupUrl = `/api/appointments?page=0&size=500&dateFrom=${date}&dateTo=${date}`
		+ (patientId ? `&patientId=${encodeURIComponent(patientId)}` : '');
	const res = await apiService.fetch(dupUrl);
	if (!res.ok) { return false; }
	const data = await res.json();
	const existing = (data?.data?.content || data?.content || (Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []))) as Record<string, unknown>[];
	// A row with no patient identity of its own is trusted to belong to this
	// patient only when the server was asked to filter by patientId.
	const rowIsAnonymous = (a: Record<string, unknown>): boolean => !resolveApptPatientId(a) && !String(a.patientName || '').trim();
	const matchesPatient = (a: Record<string, unknown>): boolean => {
		const aPid = resolveApptPatientId(a);
		if (patientId && aPid) { return String(aPid) === String(patientId); }
		return !!patientName && String(a.patientName || '').trim().toLowerCase() === patientName.trim().toLowerCase();
	};
	return existing.some(a => {
		if (String(a.status || '').toLowerCase() === 'cancelled') { return false; }
		const aDate = parseApptDate(a);
		return !!aDate && localDateStr(aDate) === date && (matchesPatient(a) || (!!patientId && rowIsAnonymous(a)));
	});
}
