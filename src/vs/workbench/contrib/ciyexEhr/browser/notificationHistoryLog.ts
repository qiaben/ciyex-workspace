/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Persistent log of workbench notifications ("actions") backing the
 * notification center's expand-to-tab history view. Entries are kept for
 * 30 days — anything older is pruned on every read/write, so the store
 * never grows unbounded.
 */
export interface INotificationLogEntry {
	/** Epoch millis when the notification was shown. */
	ts: number;
	severity: 'info' | 'warning' | 'error';
	message: string;
	source?: string;
}

const LOG_KEY = 'ciyex_notification_log';
const RETENTION_DAYS = 30;
// Hard cap as a second safety net (a runaway notifier can't fill the store
// within the retention window).
const MAX_ENTRIES = 2000;

function prune(list: INotificationLogEntry[]): INotificationLogEntry[] {
	const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
	return list
		.filter(e => e && typeof e.ts === 'number' && e.ts >= cutoff && typeof e.message === 'string' && e.message.trim() !== '')
		.sort((a, b) => b.ts - a.ts)
		.slice(0, MAX_ENTRIES);
}

/** Read the pruned notification log, most recent entry first. */
export function readNotificationLog(): INotificationLogEntry[] {
	try {
		const raw = localStorage.getItem(LOG_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return prune(Array.isArray(parsed) ? parsed as INotificationLogEntry[] : []);
	} catch {
		return [];
	}
}

/** Append an entry to the notification log (and prune expired ones). */
export function recordNotification(entry: INotificationLogEntry): void {
	if (!entry.message || !entry.message.trim()) { return; }
	try {
		const list = prune([entry, ...readNotificationLog()]);
		localStorage.setItem(LOG_KEY, JSON.stringify(list));
	} catch { /* storage unavailable — history is best-effort */ }
}
