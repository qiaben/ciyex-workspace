/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextKeyService, IContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ICiyexApiService } from './ciyexApiService.js';

export const ICiyexPermissionService = createDecorator<ICiyexPermissionService>('ciyexPermissionService');

export interface ICiyexPermissionService {
	readonly _serviceBrand: undefined;
	readonly onDidChangePermissions: Event<void>;
	readonly permissions: string[];
	readonly role: string;
	hasPermission(key: string): boolean;
	hasCategory(category: string): boolean;
	hasCategoryWrite(category: string): boolean;
	canWriteResource(resourceType: string): boolean;
	canReadResource(resourceType: string): boolean;
	loadPermissions(): Promise<void>;
}

const PERMISSION_CATEGORIES = [
	'scheduling', 'demographics', 'chart', 'rx', 'orders',
	'documents', 'messaging', 'billing', 'reports', 'admin',
] as const;

export class CiyexPermissionService extends Disposable implements ICiyexPermissionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePermissions = this._register(new Emitter<void>());
	readonly onDidChangePermissions: Event<void> = this._onDidChangePermissions.event;

	private _permissions: string[] = [];
	private _writableResources: string[] = [];
	private _readableResources: string[] = [];
	private _role = '';
	private readonly _contextKeys = new Map<string, IContextKey<boolean>>();

	get permissions(): string[] { return this._permissions; }
	get role(): string { return this._role; }

	constructor(
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super();
	}

	hasPermission(key: string): boolean {
		return this._permissions.includes(key);
	}

	hasCategory(category: string): boolean {
		return this._permissions.some(p => p.startsWith(`${category}.`));
	}

	hasCategoryWrite(category: string): boolean {
		return this._permissions.includes(`${category}.write`);
	}

	canWriteResource(resourceType: string): boolean {
		return this._writableResources.includes(resourceType);
	}

	canReadResource(resourceType: string): boolean {
		return this._readableResources.includes(resourceType);
	}

	async loadPermissions(): Promise<void> {
		try {
			const data = await this.apiService.fetchJson<{
				permissions: string[];
				writableResources: string[];
				readableResources: string[];
				role: string;
			}>('/api/user/permissions');

			this._permissions = data.permissions || [];
			this._writableResources = data.writableResources || [];
			this._readableResources = data.readableResources || [];
			this._role = data.role || '';

			this._updateContextKeys();
			this._onDidChangePermissions.fire();
		} catch (err) {
			// If permissions endpoint fails, set minimal defaults
			console.warn('[CiyexPermissions] Failed to load permissions:', err);
		}
	}

	private _updateContextKeys(): void {
		// Set permission category context keys
		for (const cat of PERMISSION_CATEGORIES) {
			const hasRead = this._permissions.some(p => p.startsWith(`${cat}.`));
			const hasWrite = this._permissions.includes(`${cat}.write`);
			this._setKey(`ciyex.perm.${cat}`, hasRead);
			this._setKey(`ciyex.perm.${cat}.write`, hasWrite);
		}

		// Set FHIR resource scope context keys
		for (const resource of this._readableResources) {
			this._setKey(`ciyex.fhir.read.${resource}`, true);
		}
		for (const resource of this._writableResources) {
			this._setKey(`ciyex.fhir.write.${resource}`, true);
		}

		// Set role context keys
		const role = this._role.toUpperCase();
		this._setKey('ciyex.role.admin', role === 'ADMIN' || role === 'SUPER_ADMIN');
		this._setKey('ciyex.role.provider', role === 'PROVIDER');
		this._setKey('ciyex.role.nurse', role === 'NURSE' || role === 'MA');
		this._setKey('ciyex.role.billing', role === 'BILLING');
		this._setKey('ciyex.role.frontDesk', role === 'FRONT_DESK');

		// General authenticated key
		this._setKey('ciyex.authenticated', true);
	}

	private _setKey(key: string, value: boolean): void {
		let ctxKey = this._contextKeys.get(key);
		if (!ctxKey) {
			ctxKey = this.contextKeyService.createKey<boolean>(key, false);
			this._contextKeys.set(key, ctxKey);
		}
		ctxKey.set(value);
	}
}
