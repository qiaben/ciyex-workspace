/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize2 } from '../../../../nls.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ACTIVE_GROUP } from '../../../services/editor/common/editorService.js';

/**
 * Tab Manager - Interactive webview for managing patient chart tabs
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'ciyex.openChartLayout',
			title: localize2('chartLayout', "Configure Chart Layout"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const api = accessor.get(ICiyexApiService);
		const ws = accessor.get(IWebviewWorkbenchService);

		// Fetch data
		let layoutData: Record<string, unknown> = {};
		let configSource = 'UNIVERSAL_DEFAULT';
		try {
			const res = await api.fetch('/api/tab-field-config/layout');
			if (res.ok) {
				const data = await res.json();
				layoutData = data?.data || data || {};
				configSource = (layoutData as Record<string, string>).source || 'UNIVERSAL_DEFAULT';
			}
		} catch { /* use empty */ }

		const tabConfig = (layoutData as Record<string, unknown>).tabConfig as Array<Record<string, unknown>> || [];

		const input = ws.openWebview(
			{ title: 'Chart Layout', options: { enableFindWidget: true, retainContextWhenHidden: true }, contentOptions: { allowScripts: true, localResourceRoots: [] }, extension: undefined },
			'ciyex.chartLayout', 'Chart Layout', undefined, { group: ACTIVE_GROUP, preserveFocus: false },
		);

		input.webview.setHtml(buildTabManagerHtml(tabConfig, configSource, api.apiUrl));

		// Listen for messages from webview
		(input.webview as unknown as { onDidReceiveMessage: (listener: (msg: unknown) => void) => void }).onDidReceiveMessage(async (rawMsg: unknown) => {
			const msg = rawMsg as { type: string; data?: unknown };
			if (msg.type === 'save') {
				try {
					const res = await api.fetch('/api/tab-field-config/layout', {
						method: 'PUT',
						body: JSON.stringify({ tabConfig: msg.data }),
					});
					input.webview.postMessage({ type: 'saveResult', success: res.ok });
				} catch {
					input.webview.postMessage({ type: 'saveResult', success: false });
				}
			} else if (msg.type === 'reset') {
				try {
					await api.fetch('/api/tab-field-config/layout', { method: 'DELETE' });
					// Reload
					const res = await api.fetch('/api/tab-field-config/layout');
					if (res.ok) {
						const data = await res.json();
						input.webview.postMessage({ type: 'reload', data: data?.data || data });
					}
				} catch {
					input.webview.postMessage({ type: 'saveResult', success: false });
				}
			}
		});
	}
});

function buildTabManagerHtml(tabConfig: Array<Record<string, unknown>>, configSource: string, apiUrl: string): string {
	const sourceBadge = configSource === 'ORG_CUSTOM'
		? '<span style="background:#0e639c;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">Custom Config</span>'
		: configSource === 'PRACTICE_TYPE_DEFAULT'
			? '<span style="background:#2ea043;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;">Practice Default</span>'
			: '<span style="background:#3c3c3c;color:#858585;padding:2px 8px;border-radius:4px;font-size:11px;">Universal Default</span>';

	let categoriesHtml = '';
	for (const cat of tabConfig) {
		const catLabel = cat.label as string || 'Unknown';
		const tabs = cat.tabs as Array<Record<string, unknown>> || [];

		let tabsHtml = '';
		for (const tab of tabs) {
			const vis = tab.visible !== false;
			// visibility handled by opacity
			const opacity = vis ? '1' : '0.4';
			const fhirBadges = Array.isArray(tab.fhirResources) && tab.fhirResources.length > 0
				? tab.fhirResources.map((r: Record<string, string>) => `<span class="fhir-badge">${typeof r === 'string' ? r : r.type}</span>`).join('')
				: '';

			tabsHtml += `
				<div class="tab-row" style="opacity:${opacity}" data-key="${tab.key}">
					<span class="tab-icon">${tab.icon || 'FileText'}</span>
					<span class="tab-label">${tab.label || tab.key}</span>
					<span class="tab-key">${tab.key}</span>
					${fhirBadges}
					<span class="tab-actions">
						<button class="btn-icon" onclick="toggleVisibility('${tab.key}')" title="${vis ? 'Hide' : 'Show'}">${vis ? '👁' : '👁‍🗨'}</button>
						<button class="btn-icon" onclick="moveTab('${tab.key}', -1)" title="Move Up">▲</button>
						<button class="btn-icon" onclick="moveTab('${tab.key}', 1)" title="Move Down">▼</button>
					</span>
				</div>`;
		}

		const visCount = tabs.filter(t => t.visible !== false).length;
		categoriesHtml += `
			<div class="category" data-label="${catLabel}">
				<div class="category-header">
					<span class="category-label">${catLabel}</span>
					<span class="category-count">${visCount}/${tabs.length} visible</span>
					<button class="btn-icon" onclick="moveCategory('${catLabel}', -1)">▲</button>
					<button class="btn-icon" onclick="moveCategory('${catLabel}', 1)">▼</button>
				</div>
				<div class="tab-list">${tabsHtml}</div>
			</div>`;
	}

	return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
	body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; background:var(--vscode-editor-background,#1e1e1e); color:var(--vscode-editor-foreground,#ccc); padding:20px; margin:0; font-size:13px; }
	h1 { margin:0 0 4px; font-size:18px; }
	.subtitle { color:var(--vscode-descriptionForeground,#858585); margin-bottom:16px; font-size:12px; }
	.toolbar { display:flex; gap:8px; align-items:center; margin-bottom:16px; }
	.btn { padding:6px 14px; border-radius:4px; border:none; cursor:pointer; font-size:12px; font-weight:600; }
	.btn-primary { background:#0e639c; color:#fff; }
	.btn-primary:hover { background:#1177bb; }
	.btn-danger { background:#a1260d; color:#fff; }
	.btn-secondary { background:#3c3c3c; color:#ccc; border:1px solid #555; }
	.btn-icon { background:none; border:none; cursor:pointer; color:#858585; padding:2px 4px; font-size:12px; }
	.btn-icon:hover { color:#fff; }
	.category { background:var(--vscode-editorWidget-background,#252526); border:1px solid var(--vscode-editorWidget-border,#3c3c3c); border-radius:6px; margin-bottom:12px; }
	.category-header { display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid var(--vscode-editorWidget-border,#3c3c3c); background:rgba(255,255,255,0.02); }
	.category-label { font-weight:600; flex:1; }
	.category-count { color:#858585; font-size:11px; }
	.tab-list { padding:4px 0; }
	.tab-row { display:flex; align-items:center; gap:8px; padding:6px 14px; border-bottom:1px solid rgba(255,255,255,0.04); }
	.tab-row:hover { background:rgba(255,255,255,0.03); }
	.tab-icon { color:#858585; font-size:11px; width:80px; }
	.tab-label { flex:1; font-weight:500; }
	.tab-key { color:#858585; font-size:11px; font-family:monospace; }
	.tab-actions { display:flex; gap:2px; }
	.fhir-badge { background:#1e3a5f; color:#6bb3f0; padding:1px 6px; border-radius:3px; font-size:10px; margin-left:4px; }
	.toast { position:fixed; top:16px; right:16px; padding:10px 16px; border-radius:6px; font-size:12px; z-index:999; }
	.toast-success { background:#2ea043; color:#fff; }
	.toast-error { background:#a1260d; color:#fff; }
</style>
</head>
<body>
	<h1>Chart Layout ${sourceBadge}</h1>
	<div class="subtitle">Manage patient chart tabs — show/hide, reorder, and organize by category</div>
	<div class="toolbar">
		<button class="btn btn-primary" onclick="save()">Save Changes</button>
		<button class="btn btn-danger" onclick="resetDefaults()">Reset to Defaults</button>
	</div>
	<div id="categories">${categoriesHtml}</div>
	<div id="toast" class="toast" style="display:none"></div>

	<script>
		const vscode = acquireVsCodeApi();
		let tabConfig = ${JSON.stringify(tabConfig)};

		function save() {
			vscode.postMessage({ type: 'save', data: tabConfig });
		}

		function resetDefaults() {
			if (confirm('Reset chart layout to defaults? This will remove all custom tab changes.')) {
				vscode.postMessage({ type: 'reset' });
			}
		}

		function toggleVisibility(tabKey) {
			for (const cat of tabConfig) {
				for (const tab of cat.tabs) {
					if (tab.key === tabKey) {
						tab.visible = !tab.visible;
						break;
					}
				}
			}
			rerender();
		}

		function moveTab(tabKey, direction) {
			for (const cat of tabConfig) {
				const idx = cat.tabs.findIndex(t => t.key === tabKey);
				if (idx >= 0) {
					const newIdx = idx + direction;
					if (newIdx >= 0 && newIdx < cat.tabs.length) {
						[cat.tabs[idx], cat.tabs[newIdx]] = [cat.tabs[newIdx], cat.tabs[idx]];
						cat.tabs.forEach((t, i) => t.position = i);
					}
					break;
				}
			}
			rerender();
		}

		function moveCategory(label, direction) {
			const idx = tabConfig.findIndex(c => c.label === label);
			if (idx >= 0) {
				const newIdx = idx + direction;
				if (newIdx >= 0 && newIdx < tabConfig.length) {
					[tabConfig[idx], tabConfig[newIdx]] = [tabConfig[newIdx], tabConfig[idx]];
					tabConfig.forEach((c, i) => c.position = i);
				}
			}
			rerender();
		}

		function rerender() {
			// Simple re-render by rebuilding the categories HTML
			let html = '';
			for (const cat of tabConfig) {
				let tabsHtml = '';
				for (const tab of cat.tabs) {
					const vis = tab.visible !== false;
					const opacity = vis ? '1' : '0.4';
					const fhirBadges = (tab.fhirResources || []).map(r => '<span class="fhir-badge">' + (typeof r === 'string' ? r : r.type) + '</span>').join('');
					tabsHtml += '<div class="tab-row" style="opacity:' + opacity + '"><span class="tab-icon">' + (tab.icon||'') + '</span><span class="tab-label">' + (tab.label||tab.key) + '</span><span class="tab-key">' + tab.key + '</span>' + fhirBadges + '<span class="tab-actions"><button class="btn-icon" onclick="toggleVisibility(\\''+tab.key+'\\')">'+( vis?'👁':'👁‍🗨')+'</button><button class="btn-icon" onclick="moveTab(\\''+tab.key+'\\', -1)">▲</button><button class="btn-icon" onclick="moveTab(\\''+tab.key+'\\', 1)">▼</button></span></div>';
				}
				const visCount = cat.tabs.filter(t => t.visible !== false).length;
				html += '<div class="category"><div class="category-header"><span class="category-label">' + cat.label + '</span><span class="category-count">' + visCount + '/' + cat.tabs.length + ' visible</span><button class="btn-icon" onclick="moveCategory(\\''+cat.label+'\\', -1)">▲</button><button class="btn-icon" onclick="moveCategory(\\''+cat.label+'\\', 1)">▼</button></div><div class="tab-list">' + tabsHtml + '</div></div>';
			}
			document.getElementById('categories').innerHTML = html;
		}

		function showToast(msg, type) {
			const el = document.getElementById('toast');
			el.textContent = msg;
			el.className = 'toast toast-' + type;
			el.style.display = 'block';
			setTimeout(() => el.style.display = 'none', 3000);
		}

		window.addEventListener('message', event => {
			const msg = event.data;
			if (msg.type === 'saveResult') {
				showToast(msg.success ? 'Saved successfully!' : 'Failed to save', msg.success ? 'success' : 'error');
			} else if (msg.type === 'reload') {
				tabConfig = msg.data.tabConfig || [];
				rerender();
				showToast('Reset to defaults', 'success');
			}
		});
	</script>
</body>
</html>`;
}
