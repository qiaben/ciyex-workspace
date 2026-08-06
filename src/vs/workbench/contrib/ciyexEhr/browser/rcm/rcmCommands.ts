/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../../nls.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { ICommandService, CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { ICiyexInstallationsService } from '../ciyexInstallationsService.js';
import { ICiyexRcmApiService, CONTEXT_RCM_INSTALLED, RCM_APP_SLUG } from './rcmApiService.js';
import { RcmDashboardEditorInput, RcmClaimEditorInput, RcmRemittanceEditorInput } from '../editors/ciyexEditorInput.js';
import { activeCoverage, loadPatientCoverages } from '../editors/patientCoverage.js';

/**
 * Runtime install gate shared by every RCM command. The `precondition`
 * context key already disables the commands in menus/palette, but commands
 * invoked programmatically (row clicks, other modules) still need the check —
 * point non-subscribed orgs at the marketplace checkout instead of failing.
 */
function ensureRcmInstalled(accessor: ServicesAccessor): boolean {
	const installations = accessor.get(ICiyexInstallationsService);
	if (installations.isInstalled(RCM_APP_SLUG)) { return true; }
	const notifications = accessor.get(INotificationService);
	const commands = accessor.get(ICommandService);
	notifications.notify({
		severity: Severity.Info,
		message: 'Revenue Cycle Management is a marketplace app. Install Qiaben RCM from the Hub to unlock billing, claims and denials.',
		actions: {
			primary: [{
				id: 'ciyex.rcm.goToCheckout', label: 'Open Marketplace', tooltip: '', class: undefined, enabled: true,
				run: () => commands.executeCommand('ciyex.payment.checkout', RCM_APP_SLUG),
			}],
		},
	});
	return false;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.rcm.openDashboard',
			title: localize2('rcmOpenDashboard', "Open Billing Dashboard (RCM)"),
			f1: true,
			precondition: CONTEXT_RCM_INSTALLED,
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		if (!ensureRcmInstalled(accessor)) { return; }
		await accessor.get(IEditorService).openEditor(new RcmDashboardEditorInput(), { pinned: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.rcm.openClaim',
			title: localize2('rcmOpenClaim', "Open RCM Claim"),
			f1: false,
			precondition: CONTEXT_RCM_INSTALLED,
		});
	}
	async run(accessor: ServicesAccessor, claimId?: string, claimLabel?: string): Promise<void> {
		if (!ensureRcmInstalled(accessor)) { return; }
		if (!claimId) { return; }
		await accessor.get(IEditorService).openEditor(new RcmClaimEditorInput(String(claimId), claimLabel), { pinned: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.rcm.openRemittance',
			title: localize2('rcmOpenRemittance', "Open Remittance (RCM)"),
			f1: false,
			precondition: CONTEXT_RCM_INSTALLED,
		});
	}
	async run(accessor: ServicesAccessor, batchId?: string, batchLabel?: string): Promise<void> {
		if (!ensureRcmInstalled(accessor)) { return; }
		if (!batchId) { return; }
		await accessor.get(IEditorService).openEditor(new RcmRemittanceEditorInput(String(batchId), batchLabel), { pinned: true });
	}
});

interface EligibilityResult {
	eligible?: boolean; statusDescription?: string; payerName?: string; planName?: string; groupNumber?: string;
	coverageType?: string; coverageStartDate?: string; coverageEndDate?: string;
	copay?: number; coinsurancePercent?: number; deductible?: number; deductibleMet?: number; deductibleRemaining?: number;
	outOfPocketMax?: number; outOfPocketMet?: number; priorAuthRequired?: boolean; referralRequired?: boolean;
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.rcm.verifyEligibility',
			title: localize2('rcmVerifyEligibility', "Verify Insurance Eligibility (RCM)"),
			f1: true,
			precondition: CONTEXT_RCM_INSTALLED,
		});
	}
	async run(accessor: ServicesAccessor, patientId?: string, patientName?: string): Promise<void> {
		if (!ensureRcmInstalled(accessor)) { return; }
		const rcmApi = accessor.get(ICiyexRcmApiService);
		const apiService = accessor.get(ICiyexApiService);
		const notifications = accessor.get(INotificationService);
		const dialogs = accessor.get(IDialogService);

		if (!patientId) {
			notifications.notify({ severity: Severity.Info, message: 'Open a patient chart or snapshot, then run the eligibility check from there.' });
			return;
		}

		// Demographics come from the patient record; coverage does NOT. A patient's
		// insurance is a FHIR Coverage resource, and `/api/patients/{id}` has never
		// carried it — so this used to ask the payer "is this patient covered?"
		// without naming the payer or the member, while the fee sheet two panels away
		// read the same coverage correctly. Use the one loader that knows where it
		// lives, so a 270 goes out complete or not at all.
		let demo: Record<string, unknown> = {};
		const [demoResult, coverages] = await Promise.all([
			(async () => {
				try {
					const res = await apiService.fetch(`/api/patients/${encodeURIComponent(patientId)}`);
					return res.ok ? await res.json() : null;
				} catch { return null; }
			})(),
			loadPatientCoverages(apiService, String(patientId)),
		]);
		if (demoResult) { demo = (demoResult?.data ?? demoResult) as Record<string, unknown>; }

		const coverage = activeCoverage(coverages);
		if (!coverage) {
			notifications.notify({
				severity: Severity.Warning,
				message: `No insurance on file for ${patientName || 'this patient'} — add their coverage before checking eligibility.`,
			});
			return;
		}

		const request = {
			patientId: String(patientId),
			patientFirstName: demo.firstName ?? undefined,
			patientLastName: demo.lastName ?? undefined,
			patientDob: demo.dob ?? demo.dateOfBirth ?? undefined,
			subscriberId: coverage.memberId || undefined,
			payerName: coverage.payerName || undefined,
			groupNumber: coverage.groupNumber || undefined,
			serviceType: '30',
			dateOfService: new Date().toISOString().slice(0, 10),
		};

		try {
			const json = await rcmApi.fetchJson<{ data?: EligibilityResult }>('/api/rcm/eligibility/verify', {
				method: 'POST',
				body: JSON.stringify(request),
			});
			const r = (json?.data ?? json ?? {}) as EligibilityResult;
			const money = (v: unknown) => v === undefined || v === null ? '—' : `$${Number(v).toFixed(2)}`;
			const lines = [
				`Status: ${r.eligible ? 'ACTIVE — coverage in force' : 'NOT ELIGIBLE / inactive'}${r.statusDescription ? ` (${r.statusDescription})` : ''}`,
				`Payer: ${r.payerName || '—'}   Plan: ${r.planName || '—'}${r.coverageType ? ` (${r.coverageType})` : ''}`,
				`Coverage: ${r.coverageStartDate || '—'} → ${r.coverageEndDate || 'open'}`,
				`Copay: ${money(r.copay)}   Coinsurance: ${r.coinsurancePercent ?? '—'}%`,
				`Deductible: ${money(r.deductible)} (met ${money(r.deductibleMet)}, remaining ${money(r.deductibleRemaining)})`,
				`Out-of-pocket max: ${money(r.outOfPocketMax)} (met ${money(r.outOfPocketMet)})`,
				`Prior auth required: ${r.priorAuthRequired ? 'YES' : 'no'}   Referral required: ${r.referralRequired ? 'YES' : 'no'}`,
			];
			await dialogs.info(`Eligibility — ${patientName || demo.firstName ? `${demo.firstName ?? ''} ${demo.lastName ?? ''}`.trim() || patientName : patientId}`, lines.join('\n'));
		} catch (e) {
			notifications.notify({ severity: Severity.Error, message: `Eligibility check failed: ${e instanceof Error ? e.message : e}` });
		}
	}
});

/**
 * Subscription toggle driven by the bundled `ciyex-rcm` extension.
 *
 * The extension's activate() calls `ciyex.rcm.registerSubscription` and its
 * deactivate() calls `ciyex.rcm.unregisterSubscription`, mirroring how the
 * payment-gateway extensions announce themselves via `ciyex.payment.registerGateway`.
 * Enabling the extension in the Extensions view therefore switches the org into
 * RCM subscription mode (Billing (RCM) sidebar, claims, denials, ERA posting),
 * and disabling it drops back to the non-subscription "lite" billing that ships
 * in the Payments editor. These commands are internal (f1:false) — users toggle
 * RCM by enabling/disabling the extension, not by running a command.
 */
CommandsRegistry.registerCommand('ciyex.rcm.registerSubscription', (accessor: ServicesAccessor) => {
	accessor.get(ICiyexInstallationsService).setExtensionEnabled(RCM_APP_SLUG, true);
});

CommandsRegistry.registerCommand('ciyex.rcm.unregisterSubscription', (accessor: ServicesAccessor) => {
	accessor.get(ICiyexInstallationsService).setExtensionEnabled(RCM_APP_SLUG, false);
});
