/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { ICiyexApiService } from '../ciyexApiService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { ReportsEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

// ─── Chart helpers (pure HTML/CSS, no external libs) ───

function renderBarChart(parent: HTMLElement, data: Array<{ label: string; value: number }>, color = '#3b82f6'): void {
	const max = Math.max(...data.map(d => d.value), 1);
	const chart = DOM.append(parent, DOM.$('div'));
	chart.style.cssText = 'display:flex;align-items:flex-end;gap:4px;height:160px;padding:8px 0;';
	for (const d of data) {
		const col = DOM.append(chart, DOM.$('div'));
		col.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;';
		const bar = DOM.append(col, DOM.$('div'));
		const h = Math.max((d.value / max) * 120, 2);
		bar.style.cssText = `width:100%;max-width:40px;height:${h}px;background:${color};border-radius:3px 3px 0 0;transition:height 0.3s;`;
		bar.title = `${d.label}: ${d.value}`;
		const val = DOM.append(col, DOM.$('div'));
		val.textContent = String(d.value);
		val.style.cssText = 'font-size:10px;font-weight:600;';
		const lbl = DOM.append(col, DOM.$('div'));
		lbl.textContent = d.label;
		lbl.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;';
	}
}

function renderPieChart(parent: HTMLElement, data: Array<{ label: string; value: number; color: string }>): void {
	const total = data.reduce((s, d) => s + d.value, 0) || 1;
	const row = DOM.append(parent, DOM.$('div'));
	row.style.cssText = 'display:flex;gap:16px;align-items:center;';

	// CSS conic-gradient pie
	const pie = DOM.append(row, DOM.$('div'));
	let gradient = '';
	let angle = 0;
	for (const d of data) {
		const pct = (d.value / total) * 360;
		gradient += `${d.color} ${angle}deg ${angle + pct}deg, `;
		angle += pct;
	}
	pie.style.cssText = `width:120px;height:120px;border-radius:50%;background:conic-gradient(${gradient.slice(0, -2)});flex-shrink:0;`;

	// Legend
	const legend = DOM.append(row, DOM.$('div'));
	legend.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
	for (const d of data) {
		const item = DOM.append(legend, DOM.$('div'));
		item.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const dot = DOM.append(item, DOM.$('span'));
		dot.style.cssText = `width:10px;height:10px;border-radius:2px;background:${d.color};flex-shrink:0;`;
		const lbl = DOM.append(item, DOM.$('span'));
		lbl.textContent = `${d.label}: ${d.value} (${Math.round(d.value / total * 100)}%)`;
		lbl.style.cssText = 'font-size:11px;';
	}
}

function renderKpiCards(parent: HTMLElement, cards: Array<{ label: string; value: string | number; color?: string; icon?: string }>): void {
	const row = DOM.append(parent, DOM.$('div'));
	row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;';
	for (const c of cards) {
		const card = DOM.append(row, DOM.$('div'));
		card.style.cssText = `flex:1;min-width:140px;padding:14px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;${c.color ? `border-left:3px solid ${c.color};` : ''}`;
		if (c.icon) {
			const ico = DOM.append(card, DOM.$('div'));
			ico.textContent = c.icon;
			ico.style.cssText = 'font-size:20px;margin-bottom:4px;';
		}
		const val = DOM.append(card, DOM.$('div'));
		val.textContent = String(c.value);
		val.style.cssText = 'font-size:22px;font-weight:700;';
		const lbl = DOM.append(card, DOM.$('div'));
		lbl.textContent = c.label;
		lbl.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';
	}
}

// renderTable available for future use in report detail views

// ─── Report configs (what to show for each report key) ───

interface ReportConfig {
	apiPaths: string[];
	render: (container: HTMLElement, data: Record<string, unknown>[]) => void;
}

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

function buildReportConfig(reportKey: string): ReportConfig {
	switch (reportKey) {
		case 'patient-demographics':
			return {
				apiPaths: ['/api/fhir-resource/patients?page=0&size=200'],
				render: (container, [data]) => {
					const patients = (data as unknown as { content?: Array<Record<string, string>> })?.content || [];
					const genderCounts: Record<string, number> = {};
					const statusCounts: Record<string, number> = {};
					for (const p of patients) {
						genderCounts[p.gender || 'unknown'] = (genderCounts[p.gender || 'unknown'] || 0) + 1;
						statusCounts[p.active === 'true' ? 'Active' : 'Inactive'] = (statusCounts[p.active === 'true' ? 'Active' : 'Inactive'] || 0) + 1;
					}
					renderKpiCards(container, [
						{ label: 'Total Patients', value: patients.length, icon: '👥', color: '#3b82f6' },
						{ label: 'Active', value: statusCounts['Active'] || 0, icon: '✓', color: '#22c55e' },
						{ label: 'Inactive', value: statusCounts['Inactive'] || 0, icon: '○', color: '#6b7280' },
					]);
					const section = DOM.append(container, DOM.$('h3'));
					section.textContent = 'Gender Distribution';
					section.style.cssText = 'font-size:14px;font-weight:600;margin:16px 0 8px;';
					renderPieChart(container, Object.entries(genderCounts).map(([k, v], i) => ({ label: k, value: v, color: COLORS[i % COLORS.length] })));
				},
			};

		case 'encounter-summary':
			return {
				apiPaths: ['/api/fhir-resource/encounters?page=0&size=200'],
				render: (container, [data]) => {
					const encounters = (data as unknown as { content?: Array<Record<string, string>> })?.content || [];
					const statusCounts: Record<string, number> = {};
					const typeCounts: Record<string, number> = {};
					for (const e of encounters) {
						statusCounts[e.status || 'unknown'] = (statusCounts[e.status || 'unknown'] || 0) + 1;
						typeCounts[e.type || 'Other'] = (typeCounts[e.type || 'Other'] || 0) + 1;
					}
					renderKpiCards(container, [
						{ label: 'Total Encounters', value: encounters.length, icon: '📋', color: '#3b82f6' },
						...Object.entries(statusCounts).slice(0, 4).map(([k, v]) => ({ label: k, value: v, color: '#22c55e' })),
					]);
					const h = DOM.append(container, DOM.$('h3'));
					h.textContent = 'By Type';
					h.style.cssText = 'font-size:14px;font-weight:600;margin:16px 0 8px;';
					renderBarChart(container, Object.entries(typeCounts).map(([k, v]) => ({ label: k, value: v })));
				},
			};

		case 'lab-orders-results':
			return {
				apiPaths: ['/api/lab-results?page=0&size=100'],
				render: (container, [data]) => {
					const results = (data as unknown as { content?: Array<Record<string, string>> })?.content || [];
					const statusCounts: Record<string, number> = {};
					for (const r of results) { statusCounts[r.status || 'unknown'] = (statusCounts[r.status || 'unknown'] || 0) + 1; }
					renderKpiCards(container, [
						{ label: 'Total Lab Results', value: results.length, icon: '🔬', color: '#3b82f6' },
						...Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: v, color: '#22c55e' })),
					]);
					renderBarChart(container, Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: v })), '#06b6d4');
				},
			};

		case 'medication-prescriptions':
			return {
				apiPaths: ['/api/prescriptions?page=0&size=200', '/api/prescriptions/stats'],
				render: (container, [listData, statsData]) => {
					const stats = (statsData || {}) as Record<string, number>;
					renderKpiCards(container, [
						{ label: 'Active', value: stats.active || 0, icon: '💊', color: '#22c55e' },
						{ label: 'Completed', value: stats.completed || 0, color: '#6b7280' },
						{ label: 'On Hold', value: stats.onHold || 0, color: '#f59e0b' },
						{ label: 'Discontinued', value: stats.discontinued || 0, color: '#ef4444' },
						{ label: 'Cancelled', value: stats.cancelled || 0, color: '#ef4444' },
					]);
					renderBarChart(container, Object.entries(stats).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ label: k, value: v as number })), '#8b5cf6');
				},
			};

		case 'referral-tracking':
			return {
				apiPaths: ['/api/referrals/stats'],
				render: (container, [statsData]) => {
					const stats = (statsData || {}) as Record<string, number>;
					renderKpiCards(container, Object.entries(stats).filter(([, v]) => typeof v === 'number').map(([k, v], i) => ({
						label: k.replace(/([A-Z])/g, ' $1').trim(), value: v as number, color: COLORS[i % COLORS.length],
					})));
					renderBarChart(container, Object.entries(stats).filter(([, v]) => typeof v === 'number').map(([k, v]) => ({ label: k, value: v as number })), '#8b5cf6');
				},
			};

		case 'immunizations':
			return {
				apiPaths: ['/api/immunizations?page=0&size=200'],
				render: (container, [data]) => {
					const items = (data as unknown as { content?: Array<Record<string, string>> })?.content || [];
					const statusCounts: Record<string, number> = {};
					const vaccineCounts: Record<string, number> = {};
					for (const i of items) {
						statusCounts[i.status || 'unknown'] = (statusCounts[i.status || 'unknown'] || 0) + 1;
						const vName = (i.vaccineName || 'Unknown').substring(0, 20);
						vaccineCounts[vName] = (vaccineCounts[vName] || 0) + 1;
					}
					renderKpiCards(container, [
						{ label: 'Total Records', value: items.length, icon: '💉', color: '#3b82f6' },
						...Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: v, color: '#22c55e' })),
					]);
					const h = DOM.append(container, DOM.$('h3'));
					h.textContent = 'Top Vaccines';
					h.style.cssText = 'font-size:14px;font-weight:600;margin:16px 0 8px;';
					renderBarChart(container, Object.entries(vaccineCounts).slice(0, 10).map(([k, v]) => ({ label: k, value: v })), '#10b981');
				},
			};

		case 'revenue-overview':
		case 'payer-mix':
		case 'cpt-utilization':
		case 'ar-aging':
			return {
				apiPaths: ['/api/prescriptions/stats'],
				render: (container) => {
					renderKpiCards(container, [
						{ label: 'Total Revenue', value: '$0', icon: '💰', color: '#22c55e' },
						{ label: 'Collected', value: '$0', icon: '✓', color: '#3b82f6' },
						{ label: 'Pending', value: '$0', icon: '⏳', color: '#f59e0b' },
						{ label: 'Denied', value: '$0', icon: '✗', color: '#ef4444' },
					]);
					const note = DOM.append(container, DOM.$('div'));
					note.textContent = 'Financial reports require RCM module integration. Connect ciyex-rcm service for full data.';
					note.style.cssText = 'padding:20px;text-align:center;color:var(--vscode-descriptionForeground);font-style:italic;';
				},
			};

		case 'appointment-volume':
			return {
				apiPaths: ['/api/fhir-resource/appointments?page=0&size=200'],
				render: (container, [data]) => {
					const appts = (data as unknown as { content?: Array<Record<string, string>> })?.content || [];
					const statusCounts: Record<string, number> = {};
					for (const a of appts) { statusCounts[a.status || 'unknown'] = (statusCounts[a.status || 'unknown'] || 0) + 1; }
					renderKpiCards(container, [
						{ label: 'Total Appointments', value: appts.length, icon: '📅', color: '#3b82f6' },
						...Object.entries(statusCounts).slice(0, 4).map(([k, v]) => ({ label: k, value: v, color: '#22c55e' })),
					]);
					renderBarChart(container, Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: v })), '#f59e0b');
				},
			};

		case 'provider-productivity':
			return {
				apiPaths: ['/api/fhir-resource/encounters?page=0&size=200'],
				render: (container, [data]) => {
					const encounters = (data as unknown as { content?: Array<Record<string, string>> })?.content || [];
					const provCounts: Record<string, number> = {};
					for (const e of encounters) {
						const prov = e.providerDisplay || e.provider || 'Unknown';
						provCounts[prov] = (provCounts[prov] || 0) + 1;
					}
					renderKpiCards(container, [
						{ label: 'Total Encounters', value: encounters.length, icon: '👨‍⚕️', color: '#8b5cf6' },
						{ label: 'Providers', value: Object.keys(provCounts).length, icon: '👥', color: '#3b82f6' },
					]);
					const h = DOM.append(container, DOM.$('h3'));
					h.textContent = 'Encounters by Provider';
					h.style.cssText = 'font-size:14px;font-weight:600;margin:16px 0 8px;';
					renderBarChart(container, Object.entries(provCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => ({ label: k.split('/').pop() || k, value: v })), '#8b5cf6');
				},
			};

		default:
			return {
				apiPaths: [],
				render: (container) => {
					const msg = DOM.append(container, DOM.$('div'));
					msg.textContent = `Report "${reportKey}" — data integration coming soon.`;
					msg.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);font-style:italic;font-size:14px;';
				},
			};
	}
}

// ─── Reports Editor ───

export class ReportsEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexReport';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(ReportsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.reports-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1000px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof ReportsEditorInput)) { return; }
		await this._loadReport(input.reportKey, input.reportLabel, input.category);
	}

	private async _loadReport(reportKey: string, reportLabel: string, category: string): Promise<void> {
		DOM.clearNode(this.contentEl);

		// Title
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'margin-bottom:20px;';
		const catBadge = DOM.append(header, DOM.$('span'));
		catBadge.textContent = category;
		catBadge.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:3px;background:rgba(0,122,204,0.1);color:var(--vscode-textLink-foreground);text-transform:uppercase;';
		const title = DOM.append(header, DOM.$('h2'));
		title.textContent = reportLabel;
		title.style.cssText = 'font-size:20px;font-weight:600;margin:8px 0 0;';

		// Loading
		const loading = DOM.append(this.contentEl, DOM.$('div'));
		loading.textContent = 'Loading report data...';
		loading.style.cssText = 'color:var(--vscode-descriptionForeground);';

		const config = buildReportConfig(reportKey);

		// Fetch all API paths
		const results: Record<string, unknown>[] = [];
		for (const path of config.apiPaths) {
			try {
				const res = await this.apiService.fetch(path);
				if (res.ok) {
					const json = await res.json();
					results.push(json?.data || json || {});
				} else {
					results.push({});
				}
			} catch {
				results.push({});
			}
		}

		// Remove loading
		loading.remove();

		// Render
		config.render(this.contentEl, results);
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
