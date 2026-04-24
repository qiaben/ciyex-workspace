/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITreeItem, ITreeViewDataProvider, TreeItemCollapsibleState } from '../../../common/views.js';
import { ICiyexApiService } from './ciyexApiService.js';

interface IPatient {
	id: string;
	fhirId: string;
	firstName: string;
	lastName: string;
	dateOfBirth: string;
	gender: string;
	phoneNumber?: string;
	email?: string;
	status: string;
}

export class PatientListDataProvider extends Disposable implements ITreeViewDataProvider {

	private readonly _onDidChangeTreeData = this._register(new Emitter<ITreeItem | undefined>());
	readonly onDidChangeTreeData: Event<ITreeItem | undefined> = this._onDidChangeTreeData.event;

	private _patients: IPatient[] = [];
	private _searchQuery = '';

	constructor(
		private readonly apiService: ICiyexApiService,
	) {
		super();
	}

	setSearchQuery(query: string): void {
		this._searchQuery = query;
		this.refresh();
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	async getChildren(element?: ITreeItem): Promise<ITreeItem[]> {
		if (element) {
			return []; // No nested children
		}

		try {
			let url = '/api/patients?page=0&size=50&sort=lastName,asc';
			if (this._searchQuery) {
				url += `&search=${encodeURIComponent(this._searchQuery)}`;
			}

			const response = await this.apiService.fetch(url);
			if (!response.ok) {
				if (response.status === 401 || response.status === 403) {
					return [this._infoItem('Waiting for login...')];
				}
				return [this._errorItem(`Failed to load patients (HTTP ${response.status})`)];
			}

			const data = await response.json();
			const content = data?.data?.content || data?.content || [];
			this._patients = content;

			if (this._patients.length === 0) {
				return [this._infoItem(this._searchQuery ? 'No patients found' : 'No patients')];
			}

			return this._patients.map(p => this._toTreeItem(p));
		} catch (err) {
			// Distinguish "no auth token yet" (common on fresh launch) from actual network errors
			if (String(err).includes('Not authenticated')) {
				return [this._infoItem('Waiting for login...')];
			}
			return [this._errorItem('Unable to connect to server')];
		}
	}

	private _toTreeItem(patient: IPatient): ITreeItem {
		const age = this._calculateAge(patient.dateOfBirth);
		const genderLabel = patient.gender === 'male' ? 'M' : patient.gender === 'female' ? 'F' : patient.gender?.charAt(0)?.toUpperCase() || '';

		return {
			handle: `patient:${patient.fhirId || patient.id}`,
			label: { label: `${patient.lastName}, ${patient.firstName}` },
			description: `${genderLabel} ${age}y | ${patient.status}`,
			tooltip: `${patient.firstName} ${patient.lastName}\nDOB: ${patient.dateOfBirth}\nGender: ${patient.gender}\nPhone: ${patient.phoneNumber || 'N/A'}\nEmail: ${patient.email || 'N/A'}`,
			collapsibleState: TreeItemCollapsibleState.None,
			themeIcon: { id: 'person' },
			command: {
				id: 'ciyex.openPatientChart',
				title: 'Open Patient Chart',
				arguments: [patient.fhirId || patient.id, `${patient.firstName} ${patient.lastName}`],
			},
		};
	}

	private _calculateAge(dob: string): number {
		if (!dob) {
			return 0;
		}
		const birth = new Date(dob);
		const today = new Date();
		let age = today.getFullYear() - birth.getFullYear();
		const m = today.getMonth() - birth.getMonth();
		if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
			age--;
		}
		return age;
	}

	private _errorItem(message: string): ITreeItem {
		return {
			handle: 'error',
			label: { label: message },
			themeIcon: { id: 'error' },
			collapsibleState: TreeItemCollapsibleState.None,
		};
	}

	private _infoItem(message: string): ITreeItem {
		return {
			handle: 'info',
			label: { label: message },
			themeIcon: { id: 'info' },
			collapsibleState: TreeItemCollapsibleState.None,
		};
	}
}
