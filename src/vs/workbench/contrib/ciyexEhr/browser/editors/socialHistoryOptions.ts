/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Single source of truth for the Social History dropdown options, shared by the
// patient snapshot editor (Schedule), the encounter form editor (Edit Encounter)
// and the snapshot demo editor. Previously each editor defined its own copy, so
// the same field showed different rows (e.g. Edit Encounter had no placeholder and
// silently defaulted to "Never"). Consumers spread these into their field configs:
// `options: [...SH_SMOKING_OPTIONS]`. The leading empty-value row doubles as the
// placeholder so no clinical value is pre-selected.

export const SH_SMOKING_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
	{ value: '', label: 'Select smoking status...' },
	{ value: 'never', label: 'Never' },
	{ value: 'former', label: 'Former' },
	{ value: 'current', label: 'Current' },
];

export const SH_ALCOHOL_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
	{ value: '', label: 'Select alcohol use...' },
	{ value: 'none', label: 'None' },
	{ value: 'social', label: 'Social' },
	{ value: 'daily', label: 'Daily' },
];

export const SH_EXERCISE_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
	{ value: '', label: 'Select exercise frequency...' },
	{ value: 'none', label: 'None' },
	{ value: '1-2', label: '1-2x/week' },
	{ value: '3-5', label: '3-5x/week' },
	{ value: 'daily', label: 'Daily' },
];

export const SH_DRUGS_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
	{ value: '', label: 'Select drug use...' },
	{ value: 'none', label: 'None' },
	{ value: 'past', label: 'Past' },
	{ value: 'current', label: 'Current' },
];
