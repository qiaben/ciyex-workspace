/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';

interface IPatientQuickPick extends IQuickPickItem {
	patientId: string;
	patientName: string;
}

/**
 * Cmd+K: Quick patient search
 * Opens a quick input with search-as-you-type against /api/patients?search=
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.searchPatient',
			title: localize2('searchPatient', "Search Patient"),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 100,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyK,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const apiService = accessor.get(ICiyexApiService);
		const commandService = accessor.get(ICommandService);

		const picker = quickInputService.createQuickPick<IPatientQuickPick>();
		picker.placeholder = 'Search patients by name or DOB (MM/DD/YYYY)...';
		picker.matchOnDescription = true;
		picker.matchOnDetail = true;

		let debounceTimer: ReturnType<typeof setTimeout> | undefined;
		let cts: CancellationTokenSource | undefined;

		picker.onDidChangeValue(value => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			if (cts) {
				cts.cancel();
			}

			if (!value.trim()) {
				picker.items = [];
				picker.busy = false;
				return;
			}

			picker.busy = true;
			debounceTimer = setTimeout(async () => {
				cts = new CancellationTokenSource();
				try {
					const response = await apiService.fetch(`/api/patients?search=${encodeURIComponent(value.trim())}&page=0&size=15`);
					if (cts.token.isCancellationRequested) {
						return;
					}
					if (response.ok) {
						const data = await response.json();
						const patients = data?.data?.content || data?.content || [];
						// The backend's ?search= is a substring match — typing
						// "Abi" returns Gabriel and Isabella because both
						// contain "abi". The test team flagged this: searches
						// should anchor at the start of a name token. Filter
						// client-side so only first/last names whose tokens
						// START WITH the query survive.
						const q = value.trim().toLowerCase();
						const prefixMatch = (p: Record<string, string>): boolean => {
							const first = (p.firstName || '').toLowerCase();
							const last = (p.lastName || '').toLowerCase();
							const middle = (p.middleName || '').toLowerCase();
							return first.startsWith(q) || last.startsWith(q) || (middle.length > 0 && middle.startsWith(q));
						};
						const filteredPatients = patients.filter(prefixMatch);
						picker.items = filteredPatients.map((p: Record<string, string>): IPatientQuickPick => {
							const age = calcAge(p.dateOfBirth);
							const g = p.gender === 'male' ? 'M' : p.gender === 'female' ? 'F' : '';
							return {
								label: `$(account) ${p.lastName}, ${p.firstName}`,
								description: `${p.dateOfBirth || ''} ${g} ${age}y`,
								detail: `${p.email || ''} ${p.phoneNumber || ''}`.trim() || undefined,
								patientId: p.fhirId || p.id,
								patientName: `${p.firstName} ${p.lastName}`,
							};
						});
					}
				} catch {
					// ignore search errors
				}
				picker.busy = false;
			}, 300); // 300ms debounce
		});

		picker.onDidAccept(() => {
			const selected = picker.selectedItems[0];
			if (selected) {
				commandService.executeCommand('ciyex.openPatientChart', selected.patientId, selected.patientName);
			}
			picker.dispose();
		});

		picker.onDidHide(() => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
			if (cts) {
				cts.cancel();
			}
			picker.dispose();
		});

		picker.show();
	}
});

function calcAge(dob: string): number {
	if (!dob) {
		return 0;
	}
	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(dob);
	const b = iso ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) : new Date(dob);
	const t = new Date();
	let a = t.getFullYear() - b.getFullYear();
	if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) {
		a--;
	}
	return a;
}
