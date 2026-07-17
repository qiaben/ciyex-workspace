/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { readNotificationLog, INotificationLogEntry } from '../notificationHistoryLog.js';

const SEVERITY_META: Record<INotificationLogEntry['severity'], { label: string; color: string; codicon: string }> = {
	info: { label: 'Info', color: '#3b82f6', codicon: 'info' },
	warning: { label: 'Warning', color: '#f59e0b', codicon: 'warning' },
	error: { label: 'Error', color: '#ef4444', codicon: 'error' },
};

/**
 * Full-tab view of the workbench notification history — the expand-to-tab
 * target of the notification center (QA request). Entries are grouped by day,
 * most recent day first, and the backing store keeps 30 days of actions.
 */
export class NotificationHistoryEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexNotificationHistory';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private _dayFilter = '';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
	) {
		super(NotificationHistoryEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-notification-history.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:980px;margin:0 auto;padding:24px 28px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		this._dayFilter = '';
		this._render();
	}

	private static _dayKey(ts: number): string {
		const d = new Date(ts);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		const entries = readNotificationLog();

		// Header
		const header = DOM.append(this.contentEl, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:4px;flex-wrap:wrap;';
		const title = DOM.append(header, DOM.$('h1'));
		title.textContent = 'Notification History';
		title.style.cssText = 'font-size:20px;font-weight:700;margin:0;flex:1;';
		const refresh = DOM.append(header, DOM.$('button')) as HTMLButtonElement;
		refresh.textContent = 'Refresh';
		refresh.style.cssText = 'padding:6px 14px;background:transparent;color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border);border-radius:5px;cursor:pointer;font-size:12px;';
		refresh.addEventListener('click', () => this._render());

		const sub = DOM.append(this.contentEl, DOM.$('div'));
		sub.textContent = 'Every notification shown in this workspace, grouped by day. Entries are kept for 30 days, then removed automatically.';
		sub.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:16px;';

		if (entries.length === 0) {
			const empty = DOM.append(this.contentEl, DOM.$('div'));
			empty.textContent = 'No notifications recorded yet. Actions you perform (saves, signs, billing, downloads…) will appear here.';
			empty.style.cssText = 'padding:40px 16px;text-align:center;color:var(--vscode-descriptionForeground);font-size:13px;border:1px dashed var(--vscode-editorWidget-border);border-radius:8px;';
			return;
		}

		// Group by day (entries arrive most-recent-first).
		const byDay = new Map<string, INotificationLogEntry[]>();
		for (const e of entries) {
			const key = NotificationHistoryEditor._dayKey(e.ts);
			const list = byDay.get(key);
			if (list) { list.push(e); } else { byDay.set(key, [e]); }
		}

		// Day filter pills — "Today" first; defaults to showing every day.
		const todayKey = NotificationHistoryEditor._dayKey(Date.now());
		const pillRow = DOM.append(this.contentEl, DOM.$('div'));
		pillRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;';
		const mkPill = (label: string, value: string, count: number): void => {
			const active = this._dayFilter === value;
			const b = DOM.append(pillRow, DOM.$('button')) as HTMLButtonElement;
			b.textContent = count ? `${label} (${count})` : label;
			b.style.cssText = `padding:4px 12px;border-radius:12px;font-size:11px;cursor:pointer;border:1px solid ${active ? 'var(--vscode-button-background,#0e639c)' : 'var(--vscode-editorWidget-border)'};background:${active ? 'var(--vscode-button-background,#0e639c)' : 'transparent'};color:${active ? 'var(--vscode-button-foreground,#fff)' : 'var(--vscode-foreground)'};`;
			b.addEventListener('click', () => { this._dayFilter = value; this._render(); });
		};
		mkPill('All days', '', entries.length);
		for (const [key, list] of byDay) {
			mkPill(key === todayKey ? 'Today' : new Date(list[0].ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), key, list.length);
		}

		for (const [key, list] of byDay) {
			if (this._dayFilter && key !== this._dayFilter) { continue; }

			const daySection = DOM.append(this.contentEl, DOM.$('div'));
			daySection.style.cssText = 'margin-bottom:20px;';
			const dayTitle = DOM.append(daySection, DOM.$('div'));
			dayTitle.textContent = `${key === todayKey ? 'Today — ' : ''}${new Date(list[0].ts).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;
			dayTitle.style.cssText = 'font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--vscode-descriptionForeground);padding-bottom:6px;border-bottom:2px solid var(--vscode-editorWidget-border);margin-bottom:2px;';

			for (const e of list) {
				const meta = SEVERITY_META[e.severity] || SEVERITY_META.info;
				const row = DOM.append(daySection, DOM.$('div'));
				row.style.cssText = 'display:grid;grid-template-columns:76px 22px 1fr auto;gap:10px;align-items:start;padding:8px 4px;border-bottom:1px solid var(--vscode-editorWidget-border);font-size:13px;';
				const time = DOM.append(row, DOM.$('span'));
				time.textContent = new Date(e.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
				time.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:12px;white-space:nowrap;padding-top:1px;';
				const ico = DOM.append(row, DOM.$('span.codicon.codicon-' + meta.codicon));
				(ico as HTMLElement).style.cssText = `color:${meta.color};font-size:14px;padding-top:1px;`;
				const msg = DOM.append(row, DOM.$('span'));
				msg.textContent = e.message;
				msg.style.cssText = 'white-space:pre-wrap;word-break:break-word;';
				const src = DOM.append(row, DOM.$('span'));
				src.textContent = e.source || '';
				src.style.cssText = 'color:var(--vscode-descriptionForeground);font-size:11px;white-space:nowrap;padding-top:2px;';
			}
		}
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
