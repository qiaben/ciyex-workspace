/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ICiyexApiService } from './ciyexApiService.js';
import { ICiyexAuthService, CiyexAuthState } from '../../ciyexAuth/browser/ciyexAuthService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import * as DOM from '../../../../base/browser/dom.js';
import { createActionIconButton, createOverflowMenuButton, createRowActionsContainer, openRecordEditDialog, renderShowMoreFooter, SIDEBAR_INITIAL_PAGE_SIZE, IOverflowMenuItem, IEditFieldDef } from './sidebarActions.js';

interface Task {
	id: string;
	title: string;
	taskType?: string;
	status: string;
	priority?: string;
	dueDate?: string;
	dueTime?: string;
	patientName?: string;
	assignedTo?: string;
}

type TaskFilter = 'active' | 'overdue' | 'done' | 'all';

const STATUS_COLORS: Record<string, string> = {
	pending: '#f59e0b',
	in_progress: '#3b82f6',
	completed: '#22c55e',
	cancelled: '#6b7280',
	deferred: '#8b5cf6',
};

const PRIORITY_COLORS: Record<string, string> = {
	urgent: '#ef4444',
	high: '#f97316',
	normal: '#3b82f6',
	low: '#9ca3af',
};

const TYPE_ICONS: Record<string, string> = {
	general: '\u{1F4CB}',
	follow_up: '\u{1F501}',
	callback: '\u{1F4DE}',
	refill: '\u{1F48A}',
	lab_review: '\u{1F52C}',
	referral: '\u{2197}',
	prior_auth: '\u{1F6E1}',
	documentation: '\u{1F4DD}',
};

export class TasksSidebarPane extends ViewPane {

	static readonly ID = 'ciyex.tasks.sidebar';

	private container!: HTMLElement;
	private searchInput?: HTMLInputElement;
	private tasks: Task[] = [];
	private filter: TaskFilter = 'active';
	private searchValue = '';
	private refreshTimer: number | undefined;
	private loaded = false;
	private visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@ILogService private readonly logService: ILogService,
		@ICiyexAuthService private readonly authService: ICiyexAuthService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);

		// Reset task cache on logout / re-login so the next user gets their
		// own tasks rather than the previous user's queue.
		this._register(this.authService.onDidChangeAuthState(state => {
			if (state === CiyexAuthState.NotAuthenticated) {
				this.tasks = [];
				this.loaded = false;
			} else if (state === CiyexAuthState.Authenticated) {
				this.tasks = [];
				this.loaded = false;
				if (this.container) {
					void this._loadAndRender();
				}
			}
		}));
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);
		this.container = DOM.append(parent, DOM.$('.tasks-sidebar.ciyex-editor-root'));
		this.container.style.cssText = 'padding:0;overflow-y:auto;height:100%;font-size:12px;';

		this._render();

		const win = DOM.getWindow(this.container);
		const poll = win.setInterval(() => {
			try {
				const token = localStorage.getItem('ciyex_token');
				if (!token) { return; }
			} catch { return; }

			if (!this.loaded) {
				this._loadAndRender();
			} else {
				win.clearInterval(poll);
				this.refreshTimer = win.setInterval(() => this._loadAndRender(), 30000);
			}
		}, 2000);

		this._loadAndRender();
	}

	private async _loadAndRender(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/tasks?page=0&size=200');
			if (res.ok) {
				const data = await res.json();
				const page = data?.data || data || {};
				this.tasks = (page.content || []) as Task[];
				this.loaded = true;
			}
		} catch (err) {
			this.logService.warn('[Tasks] Failed to load tasks:', err);
		}
		this._render();
	}

	private _isOverdue(t: Task): boolean {
		if (t.status === 'completed' || t.status === 'cancelled') { return false; }
		// An explicit 'overdue' status counts as overdue even without a due date,
		// so the sidebar's Overdue tally matches the task's stored status (QA: a
		// task marked Overdue was missed when it had no due date).
		const status = String(t.status || '').toLowerCase().replace(/[\s-]+/g, '_');
		if (status === 'overdue') { return true; }
		if (!t.dueDate) { return false; }
		const due = new Date(t.dueDate);
		if (isNaN(due.getTime())) { return false; }
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		return due < today;
	}

	private _getFiltered(): Task[] {
		const q = this.searchValue.toLowerCase();
		let out = [...this.tasks];
		if (this.filter === 'active') {
			out = out.filter(t => t.status !== 'completed' && t.status !== 'cancelled');
		} else if (this.filter === 'overdue') {
			out = out.filter(t => this._isOverdue(t));
		} else if (this.filter === 'done') {
			out = out.filter(t => t.status === 'completed');
		}
		if (q) {
			out = out.filter(t => (t.title || '').toLowerCase().includes(q) || (t.patientName || '').toLowerCase().includes(q));
		}
		out.sort((a, b) => {
			const pa = ['urgent', 'high', 'normal', 'low'].indexOf(a.priority || 'normal');
			const pb = ['urgent', 'high', 'normal', 'low'].indexOf(b.priority || 'normal');
			if (pa !== pb) { return pa - pb; }
			const da = a.dueDate || '';
			const db = b.dueDate || '';
			if (!da && db) { return 1; }
			if (da && !db) { return -1; }
			return da.localeCompare(db);
		});
		return out;
	}

	private _render(): void {
		DOM.clearNode(this.container);
		this._renderQuickActions();
		this._renderStats();
		this._renderSearch();
		this._renderFilterBar();
		this._renderTaskList();
		this._renderCategories();
	}

	private _renderQuickActions(): void {
		// Title is already shown by the VS Code view container + view pane headers;
		// here we only need the action toolbar (new + refresh) aligned to the right.
		const bar = DOM.append(this.container, DOM.$('.quick-actions'));
		bar.style.cssText = 'display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);align-items:center;justify-content:flex-end;';

		// Replace the legacy "go to full editor" with an inline create drawer.
		// The full editor still owns power-user features, but the test team
		// reported that clicking + opened a list page — they expected a form.
		createActionIconButton(bar, '+', 'New Task', () => this._openCreateDialog());
		createActionIconButton(bar, '\u{21BB}', 'Refresh', () => this._loadAndRender());
	}

	private _renderStats(): void {
		const stats = DOM.append(this.container, DOM.$('.stats-bar'));
		stats.style.cssText = 'display:flex;gap:2px;padding:8px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';

		const total = this.tasks.length;
		const done = this.tasks.filter(t => t.status === 'completed').length;
		const pending = this.tasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
		const overdue = this.tasks.filter(t => this._isOverdue(t)).length;

		this._statBadge(stats, String(total), 'Total', 'var(--vscode-foreground)');
		this._statBadge(stats, String(done), 'Completed', '#22c55e');
		this._statBadge(stats, String(pending), 'Open', '#3b82f6');
		if (overdue > 0) {
			this._statBadge(stats, String(overdue), 'Overdue', '#ef4444');
		}
	}

	private _statBadge(parent: HTMLElement, value: string, label: string, color: string): void {
		const badge = DOM.append(parent, DOM.$('.stat'));
		badge.style.cssText = `flex:1;text-align:center;padding:4px 2px;border-radius:4px;background:rgba(128,128,128,0.08);`;
		const val = DOM.append(badge, DOM.$('div'));
		val.textContent = value;
		val.style.cssText = `font-size:16px;font-weight:700;color:${color};line-height:1.2;`;
		const lbl = DOM.append(badge, DOM.$('div'));
		lbl.textContent = label;
		lbl.style.cssText = 'font-size:9px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.5px;';
	}

	private _renderSearch(): void {
		const wrap = DOM.append(this.container, DOM.$('.search-row'));
		wrap.style.cssText = 'padding:6px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		const input = DOM.append(wrap, DOM.$('input')) as HTMLInputElement;
		this.searchInput = input;
		input.type = 'text';
		input.placeholder = 'Search tasks or patients...';
		input.value = this.searchValue;
		input.style.cssText = 'width:100%;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:3px;color:var(--vscode-input-foreground);font-size:11px;box-sizing:border-box;';
		input.addEventListener('input', () => {
			this.searchValue = input.value;
			this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE;
			this._render();
			if (this.searchInput) { this.searchInput.focus(); this.searchInput.setSelectionRange(this.searchValue.length, this.searchValue.length); }
		});
	}

	private _renderFilterBar(): void {
		const bar = DOM.append(this.container, DOM.$('.filter-bar'));
		bar.style.cssText = 'display:flex;gap:2px;padding:4px 10px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		for (const f of ['active', 'overdue', 'done', 'all'] as const) {
			const btn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
			btn.type = 'button';
			btn.textContent = f === 'active' ? 'Active' : f === 'overdue' ? 'Overdue' : f === 'done' ? 'Completed' : 'All';
			const isActive = this.filter === f;
			btn.style.cssText = `flex:1;padding:3px;border:none;border-radius:3px;cursor:pointer;font-size:10px;font-weight:500;${isActive ? 'background:var(--vscode-button-background);color:var(--vscode-button-foreground);' : 'background:transparent;color:var(--vscode-descriptionForeground);'}`;
			btn.addEventListener('click', (e) => { e.preventDefault(); this.filter = f; this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._render(); });
		}
	}

	private _renderTaskList(): void {
		// Always called from _render after a clearNode, so just append fresh.
		const section = DOM.append(this.container, DOM.$('.task-list-section'));
		section.style.cssText = 'padding:4px 0;';

		const filtered = this._getFiltered();

		const header = DOM.append(section, DOM.$('.section-header'));
		header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);display:flex;align-items:center;gap:6px;';
		const lbl = DOM.append(header, DOM.$('span'));
		lbl.textContent = this.filter === 'active' ? 'Active' : this.filter === 'overdue' ? 'Overdue' : this.filter === 'done' ? 'Completed' : 'All Tasks';
		lbl.style.cssText = 'flex:1;';
		const count = DOM.append(header, DOM.$('span'));
		count.textContent = `${filtered.length}`;
		count.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(128,128,128,0.18);';

		if (filtered.length === 0) {
			const empty = DOM.append(section, DOM.$('.empty'));
			empty.style.cssText = 'padding:12px 10px;color:var(--vscode-descriptionForeground);text-align:center;font-size:12px;';
			empty.textContent = this.loaded ? 'No tasks' : 'Loading...';
		} else {
			const visible = Math.min(this.visibleCount, filtered.length);
			for (let i = 0; i < visible; i++) { this._renderTaskRow(section, filtered[i]); }
			renderShowMoreFooter(
				section,
				{ visibleCount: visible, totalCount: filtered.length },
				(next) => { this.visibleCount = next; this._render(); },
				() => { this.visibleCount = SIDEBAR_INITIAL_PAGE_SIZE; this._render(); },
			);
		}
	}

	private _renderTaskRow(parent: HTMLElement, task: Task): void {
		const overdue = this._isOverdue(task);
		const statusColor = overdue ? '#ef4444' : (STATUS_COLORS[task.status] || '#6b7280');
		const priorityColor = PRIORITY_COLORS[task.priority || 'normal'] || '#3b82f6';

		const row = DOM.append(parent, DOM.$('.task-row'));
		row.style.cssText = `padding:6px 10px;border-left:3px solid ${statusColor};border-bottom:1px solid rgba(128,128,128,0.06);cursor:pointer;position:relative;`;

		const top = DOM.append(row, DOM.$('.top'));
		top.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px;';

		const icon = DOM.append(top, DOM.$('span'));
		icon.textContent = TYPE_ICONS[task.taskType || 'general'] || '\u{1F4CB}';
		icon.style.cssText = 'font-size:12px;width:16px;flex-shrink:0;';

		const title = DOM.append(top, DOM.$('span'));
		title.textContent = task.title || 'Untitled task';
		title.style.cssText = 'flex:1;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

		if (task.priority && task.priority !== 'normal') {
			const pri = DOM.append(top, DOM.$('span'));
			pri.textContent = task.priority === 'urgent' ? '!!' : task.priority === 'high' ? '!' : '·';
			pri.style.cssText = `font-size:11px;font-weight:700;color:${priorityColor};flex-shrink:0;`;
			pri.title = `Priority: ${task.priority}`;
		}

		const mid = DOM.append(row, DOM.$('.mid'));
		mid.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:10px;color:var(--vscode-descriptionForeground);';

		if (task.patientName) {
			const pn = DOM.append(mid, DOM.$('span'));
			pn.textContent = task.patientName;
			pn.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;';
		}

		if (task.dueDate) {
			if (task.patientName) { DOM.append(mid, DOM.$('span')).textContent = '·'; }
			const due = DOM.append(mid, DOM.$('span'));
			try {
				const d = new Date(task.dueDate);
				due.textContent = isNaN(d.getTime()) ? task.dueDate : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
			} catch { due.textContent = task.dueDate; }
			if (overdue) { due.style.cssText = 'color:#ef4444;font-weight:600;'; }
		}

		const status = DOM.append(mid, DOM.$('span'));
		status.textContent = overdue ? 'OVERDUE' : (task.status || '').replace(/_/g, ' ');
		status.style.cssText = `margin-left:auto;font-size:9px;padding:1px 5px;border-radius:3px;text-transform:capitalize;background:${statusColor};color:#fff;font-weight:500;white-space:nowrap;flex-shrink:0;`;

		// ⋯ actions — placed in the top flex row at the far right so the popup
		// opens to the right of the sidebar (outside the bar), not mid-row.
		const actions = createRowActionsContainer(top);
		actions.style.cssText = 'display:flex;gap:2px;align-items:center;flex-shrink:0;opacity:0;transition:opacity 0.1s;';

		createOverflowMenuButton(actions, (): IOverflowMenuItem[] => {
			const items: IOverflowMenuItem[] = [];
			if (task.status !== 'completed' && task.status !== 'cancelled') {
				items.push({ symbol: '\u{2714}', label: 'Mark Complete', onClick: () => this._updateStatus(task, 'completed') });
			}
			if (task.status === 'pending') {
				items.push({ symbol: '\u{25B6}', label: 'Start Task', onClick: () => this._updateStatus(task, 'in_progress') });
			}
			items.push({ symbol: '\u{1F4DD}', label: 'Edit Task', onClick: () => this._openEditDialog(task) });
			if (task.status !== 'completed' && task.status !== 'cancelled') {
				items.push({ symbol: '\u{1F6AB}', label: 'Cancel Task', onClick: () => this._updateStatus(task, 'cancelled') });
			}
			items.push({ separator: true });
			items.push({ symbol: '\u{1F5D1}', label: 'Delete', onClick: () => this._deleteTask(task) });
			return items;
		});

		row.addEventListener('mouseenter', () => {
			row.style.background = 'var(--vscode-list-hoverBackground)';
			actions.style.opacity = '1';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = '';
			actions.style.opacity = '0';
		});
		row.addEventListener('click', (e) => {
			if (actions.contains(e.target as Node)) { return; }
			this.commandService.executeCommand('ciyex.openTasks');
		});
	}

	/** Shared field schema used by both the new + edit dialogs so the two
	 *  drawers stay in lockstep. The Patient Name and Assigned To fields use
	 *  `kind: 'search'` so they typeahead against /api/patients and
	 *  /api/providers — the test team flagged the previous plain text
	 *  inputs as "not searching". */
	private _taskFormFields(): IEditFieldDef[] {
		const fetchPatients = async (q: string) => {
			try {
				const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
				if (!res.ok) { return []; }
				const data = await res.json();
				const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
				return list.map(p => {
					const name = `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || String(p.name || p.id);
					const pid = String(p.id ?? p.patientId ?? '');
					return { value: name, label: name, description: pid ? `MRN ${pid}` : undefined, details: { patientId: pid } };
				});
			} catch { return []; }
		};
		const fetchProviders = async (q: string) => {
			try {
				const urls = [`/api/providers?search=${encodeURIComponent(q)}&page=0&size=10`, `/api/fhir-resource/providers?search=${encodeURIComponent(q)}&page=0&size=10`];
				for (const url of urls) {
					const res = await this.apiService.fetch(url);
					if (!res.ok) { continue; }
					const data = await res.json();
					const list = (data?.data?.content || data?.content || data?.data || []) as Array<Record<string, unknown>>;
					if (list.length === 0) { continue; }
					return list.map(p => {
						const name = (p.name || p.fullName || `${(p.firstName as string) || ''} ${(p.lastName as string) || ''}`.trim() || '') as string;
						return { value: name, label: name, description: (p.npi as string) ? `NPI ${p.npi}` : undefined };
					});
				}
				return [];
			} catch { return []; }
		};
		return [
			{ key: 'title', label: 'Title', required: true, placeholder: 'Enter task title', widthPct: 100 },
			{ key: 'description', label: 'Description', kind: 'textarea', placeholder: 'Task description...', widthPct: 100 },
			{
				key: 'taskType', label: 'Task Type', kind: 'select', widthPct: 50, options: [
					{ value: 'general', label: 'General' },
					{ value: 'follow_up', label: 'Follow Up' },
					{ value: 'callback', label: 'Callback' },
					{ value: 'refill', label: 'Refill' },
					{ value: 'lab_review', label: 'Lab Review' },
					{ value: 'referral', label: 'Referral' },
					{ value: 'prior_auth', label: 'Prior Auth' },
					{ value: 'documentation', label: 'Documentation' },
				]
			},
			{
				key: 'priority', label: 'Priority', kind: 'select', widthPct: 50, options: [
					{ value: 'urgent', label: 'Urgent' },
					{ value: 'high', label: 'High' },
					{ value: 'normal', label: 'Normal' },
					{ value: 'low', label: 'Low' },
				]
			},
			{
				key: 'status', label: 'Status', kind: 'select', widthPct: 50, options: [
					{ value: 'pending', label: 'Pending' },
					{ value: 'in_progress', label: 'In Progress' },
					{ value: 'completed', label: 'Completed' },
					{ value: 'cancelled', label: 'Cancelled' },
					{ value: 'deferred', label: 'Deferred' },
					{ value: 'overdue', label: 'Overdue' },
				]
			},
			{ key: 'dueDate', label: 'Due Date', kind: 'date', widthPct: 50 },
			{ key: 'dueTime', label: 'Due Time', kind: 'time', widthPct: 50 },
			{
				key: 'assignedTo', label: 'Assigned To', required: true, kind: 'search', placeholder: 'Search provider...', widthPct: 50,
				onSearch: fetchProviders,
			},
			{ key: 'assignedBy', label: 'Assigned By', placeholder: 'e.g. Front Desk', widthPct: 50 },
			{
				key: 'patientName', label: 'Patient Name', required: true, kind: 'search', placeholder: 'Search patient by name...', widthPct: 50,
				onSearch: fetchPatients,
				onSelectSearchResult: (item, all) => { const pid = item.details?.patientId; const i = all.get('patientId'); if (i && pid) { i.value = pid; } },
			},
			{ key: 'patientId', label: 'Patient ID', placeholder: 'Auto-filled from search', widthPct: 50 },
			{ key: 'encounterId', label: 'Encounter ID', placeholder: 'Encounter ID (optional)', widthPct: 50 },
			{ key: 'referenceType', label: 'Reference Type', placeholder: 'e.g. Order, Lab', widthPct: 50 },
			{ key: 'referenceId', label: 'Reference ID', placeholder: 'Reference ID (numeric)', widthPct: 50 },
			{ key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Additional notes...', widthPct: 100 },
		];
	}

	private _openCreateDialog(): void {
		const initialValues: Record<string, unknown> = { priority: 'normal', status: 'pending', taskType: 'general' };
		openRecordEditDialog({
			title: 'New Task',
			themeAnchor: this.container,
			fields: this._taskFormFields(),
			values: initialValues,
			primaryLabel: 'Create',
			onSave: async (next) => {
				const res = await this.apiService.fetch('/api/tasks', { method: 'POST', body: JSON.stringify(next) });
				if (!res.ok) { throw new Error(`Create failed (${res.status})`); }
				await this._loadAndRender();
			},
		});
	}

	private _openEditDialog(task: Task): void {
		openRecordEditDialog({
			title: `Edit Task — ${task.title || ''}`,
			themeAnchor: this.container,
			fields: this._taskFormFields(),
			values: task as unknown as Record<string, unknown>,
			onSave: async (next) => {
				const payload = { ...task, ...next };
				const res = await this.apiService.fetch(`/api/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(payload) });
				if (!res.ok) { throw new Error(`Update failed (${res.status})`); }
				Object.assign(task, next);
				this._render();
			},
		});
	}

	private async _deleteTask(task: Task): Promise<void> {
		// Optimistic update so the user sees the row disappear immediately
		// even when the API is slow.
		const prev = this.tasks;
		this.tasks = this.tasks.filter(t => t.id !== task.id);
		this._render();
		try {
			await this.apiService.fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
		} catch (err) {
			this.logService.warn('[Tasks] Delete failed, reverting:', err);
			this.tasks = prev;
			this._render();
		}
	}

	private async _updateStatus(task: Task, status: string): Promise<void> {
		// Optimistic update — flip status locally and re-render so the user
		// gets immediate visual feedback (status pill / badge color change).
		const prev = task.status;
		task.status = status;
		this._render();
		try {
			const res = await this.apiService.fetch(`/api/tasks/${task.id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
			if (!res.ok) {
				const res2 = await this.apiService.fetch(`/api/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ ...task, status }) });
				if (!res2.ok) { throw new Error(`status ${res2.status}`); }
			}
		} catch (err) {
			this.logService.warn('[Tasks] Status update failed, reverting:', err);
			task.status = prev;
			this._render();
		}
	}

	private _renderCategories(): void {
		const section = DOM.append(this.container, DOM.$('.task-categories'));
		section.style.cssText = 'padding:8px 0;border-top:1px solid var(--vscode-editorWidget-border);';

		const header = DOM.append(section, DOM.$('.section-header'));
		header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--vscode-descriptionForeground);';
		header.textContent = 'Categories';

		const categories: Array<{ icon: string; label: string; type: string }> = [
			{ icon: TYPE_ICONS.follow_up, label: 'Follow Up', type: 'follow_up' },
			{ icon: TYPE_ICONS.callback, label: 'Callback', type: 'callback' },
			{ icon: TYPE_ICONS.refill, label: 'Refill', type: 'refill' },
			{ icon: TYPE_ICONS.lab_review, label: 'Lab Review', type: 'lab_review' },
			{ icon: TYPE_ICONS.referral, label: 'Referral', type: 'referral' },
			{ icon: TYPE_ICONS.prior_auth, label: 'Prior Auth', type: 'prior_auth' },
			{ icon: TYPE_ICONS.documentation, label: 'Documentation', type: 'documentation' },
		];

		for (const cat of categories) {
			const count = this.tasks.filter(t => t.taskType === cat.type).length;
			const row = DOM.append(section, DOM.$('.cat-row'));
			row.style.cssText = 'padding:5px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:11px;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => {
				this.searchValue = '';
				this.filter = 'all';
				this.tasks = this.tasks; // no-op; we just want re-render with type filter
				// Visually highlight via search
				this.searchValue = cat.label;
				this._render();
			});

			const icon = DOM.append(row, DOM.$('span'));
			icon.textContent = cat.icon;
			icon.style.cssText = 'width:20px;text-align:center;flex-shrink:0;';

			const lbl = DOM.append(row, DOM.$('span'));
			lbl.textContent = cat.label;
			lbl.style.cssText = 'flex:1;';

			const badge = DOM.append(row, DOM.$('span'));
			badge.textContent = String(count);
			badge.style.cssText = 'font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(128,128,128,0.18);color:var(--vscode-descriptionForeground);';
		}
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.container) {
			this.container.style.height = `${height}px`;
		}
	}

	override dispose(): void {
		if (this.refreshTimer) {
			DOM.getActiveWindow().clearInterval(this.refreshTimer);
		}
		super.dispose();
	}
}
