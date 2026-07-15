/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Ciyex RCM extension.
 *
 * This extension carries no billing logic itself — the Revenue Cycle Management
 * suite lives natively in the workbench. Its job is to act as the on/off switch:
 * while it is enabled it announces "RCM subscription active" to the workbench,
 * which reveals the Billing (RCM) sidebar, claims, denials, ERA posting and the
 * rest. Disable it in the Extensions view and the workbench falls back to the
 * built-in non-subscription "lite" billing in the Payments editor.
 *
 * The mechanism mirrors the payment-gateway extensions: activate() calls a
 * workbench command to register, deactivate() calls one to unregister. When the
 * extension is disabled VS Code never runs activate(), so RCM stays off.
 */

const REGISTER_COMMAND = 'ciyex.rcm.registerSubscription';
const UNREGISTER_COMMAND = 'ciyex.rcm.unregisterSubscription';

let statusProvider: RcmStatusProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(
		vscode.commands.registerCommand('ciyex-rcm.status', () => {
			vscode.window.showInformationMessage(
				'Ciyex RCM is enabled — this org is in RCM subscription mode (Billing (RCM), claims, denials, ERA posting). Disable this extension to use the built-in lite billing instead.',
			);
		}),
	);

	// A small activity-bar view so the extension has a visible home while enabled
	// (VS Code hides the whole container automatically when the extension is
	// disabled), matching the payment-gateway extensions' status view.
	statusProvider = new RcmStatusProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('ciyexRcmStatus', statusProvider));

	await announceToWorkbench(REGISTER_COMMAND);
}

export async function deactivate(): Promise<void> {
	// Runs when the user disables the extension at runtime. Tell the workbench to
	// drop back to non-subscription lite billing.
	try {
		const all = await vscode.commands.getCommands(true);
		if (all.includes(UNREGISTER_COMMAND)) {
			await vscode.commands.executeCommand(UNREGISTER_COMMAND);
		}
	} catch {
		/* workbench already tearing down — nothing to do */
	}
}

/**
 * Call the workbench registration command. The command is registered by the
 * ciyexEhr workbench contribution at startup; it might activate after us, so
 * poll briefly for it (same approach as the Stripe/PayPal gateway extensions).
 */
async function announceToWorkbench(command: string): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const all = await vscode.commands.getCommands(true);
		if (all.includes(command)) {
			try {
				await vscode.commands.executeCommand(command);
			} catch (err) {
				console.warn('[ciyex-rcm] registerSubscription failed', err);
			}
			return;
		}
		await new Promise(r => setTimeout(r, 500));
	}
	console.warn('[ciyex-rcm] workbench did not expose', command, '— RCM extension is enabled but the workbench never registered it.');
}

/** Read-only status rows for the "Ciyex RCM" activity-bar view. */
class RcmStatusProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
	getChildren(): vscode.TreeItem[] {
		const active = new vscode.TreeItem('RCM subscription: ACTIVE', vscode.TreeItemCollapsibleState.None);
		active.iconPath = new vscode.ThemeIcon('pass-filled');
		active.description = 'Billing (RCM) enabled';
		const hint = new vscode.TreeItem('Disable this extension for lite billing', vscode.TreeItemCollapsibleState.None);
		hint.iconPath = new vscode.ThemeIcon('info');
		return [active, hint];
	}
}
