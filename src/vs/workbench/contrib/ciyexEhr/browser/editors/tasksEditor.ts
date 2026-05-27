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
import { INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { TasksEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { createCustomDropdown } from '../customDropdown.js';

interface Task {
	id: string;
	title: string;
	description?: string;
	taskType: string;
	status: string;
	priority: string;
	dueDate?: string;
	dueTime?: string;
	assignedTo?: string;
	assignedBy?: string;
	patientId?: string;
	patientName?: string;
	encounterId?: string;
	referenceType?: string;
	referenceId?: string;
	notes?: string;
	completedBy?: string;
	completedAt?: string;
	createdAt?: string;
}

interface TaskStats { pending: number; inProgress: number; completed: number; overdue: number }

const TASK_TYPES: Array<{ label: string; value: string }> = [
	{ label: 'General', value: 'general' }, { label: 'Follow Up', value: 'follow_up' },
	{ label: 'Callback', value: 'callback' }, { label: 'Refill', value: 'refill' },
	{ label: 'Lab Review', value: 'lab_review' }, { label: 'Referral', value: 'referral' },
	{ label: 'Prior Auth', value: 'prior_auth' }, { label: 'Documentation', value: 'documentation' },
];

const STATUSES: Array<{ label: string; value: string }> = [
	{ label: 'Pending', value: 'pending' }, { label: 'In Progress', value: 'in_progress' },
	{ label: 'Completed', value: 'completed' }, { label: 'Cancelled', value: 'cancelled' },
	{ label: 'Deferred', value: 'deferred' },
];

const PRIORITIES: Array<{ label: string; value: string }> = [
	{ label: 'Urgent', value: 'urgent' }, { label: 'High', value: 'high' },
	{ label: 'Normal', value: 'normal' }, { label: 'Low', value: 'low' },
];

const PRIORITY_COLORS: Record<string, string> = { urgent: '#ef4444', high: '#f97316', normal: '#3b82f6', low: '#9ca3af' };
const STATUS_COLORS: Record<string, string> = { pending: '#f59e0b', in_progress: '#3b82f6', completed: '#22c55e', cancelled: '#6b7280', deferred: '#8b5cf6', overdue: '#ef4444' };

function typeLabel(v: string): string { return TASK_TYPES.find(t => t.value === v)?.label || v; }
function statusLabel(v: string): string { return STATUSES.find(s => s.value === v)?.label || v.replace(/_/g, ' '); }

export class TasksEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexTasks';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private tasks: Task[] = [];
	private stats: TaskStats = { pending: 0, inProgress: 0, completed: 0, overdue: 0 };
	private filterStatus = '';
	private filterPriority = '';
	private filterType = '';
	private searchQuery = '';
	private currentPage = 0;
	private totalPages = 0;
	private totalElements = 0;
	private formOverlay: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	// Class-level search debounce — prevents multiple parallel fetches when the
	// toolbar re-renders (which would create a new closure and orphan the old timer).
	private searchTimer: ReturnType<typeof setTimeout> | undefined = undefined;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(TasksEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.tasks-editor.ciyex-editor-root'));
		// overflow:hidden + flex-column so stats/toolbar/tabs are fixed at the
		// top, the table scrolls in the middle, and pagination is fixed at the
		// bottom (issue #8 — matches the ClinicalListEditorBase sticky pattern).
		this.root.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;position:relative;';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;max-width:1100px;width:100%;margin:0 auto;padding:20px 24px;box-sizing:border-box;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof TasksEditorInput)) { return; }
		await this._loadAll();
	}

	private async _loadAll(): Promise<void> {
		await Promise.all([this._loadStats(), this._loadTasks()]);
	}

	private async _loadStats(): Promise<void> {
		try {
			const res = await this.apiService.fetch('/api/tasks/stats');
			if (res.ok) {
				const data = await res.json();
				const s = data?.data || data || {};
				this.stats = { pending: s.pending || 0, inProgress: s.inProgress || s.in_progress || 0, completed: s.completed || 0, overdue: s.overdue || 0 };
			}
		} catch { /* */ }
	}

	private async _loadTasks(): Promise<void> {
		try {
			let url = `/api/tasks?page=${this.currentPage}&size=20`;
			if (this.searchQuery) { url += `&q=${encodeURIComponent(this.searchQuery)}`; }
			if (this.filterStatus) { url += `&status=${this.filterStatus}`; }
			if (this.filterPriority) { url += `&priority=${this.filterPriority}`; }
			if (this.filterType) { url += `&taskType=${this.filterType}`; }
			const res = await this.apiService.fetch(url);
			if (res.ok) {
				const data = await res.json();
				const page = data?.data || data || {};
				this.tasks = (page.content || []) as Task[];
				this.totalPages = page.totalPages || 1;
				this.totalElements = page.totalElements || this.tasks.length;
			} else {
				this.tasks = [];
				this.totalPages = 0;
				this.totalElements = 0;
			}
		} catch {
			this.tasks = [];
			this.totalPages = 0;
			this.totalElements = 0;
		}
		// Always render so the toolbar (incl. search) is interactive even on empty/error
		this._render();
	}

	private _render(): void {
		// Preserve search-input focus across re-renders (the whole subtree is replaced,
		// so a plain render would blur the input after each keystroke).
		const win = DOM.getActiveWindow();
		const active = win.document.activeElement;
		const activeInput = DOM.isHTMLInputElement(active) ? active : null;
		const wasSearchFocused = !!(activeInput && activeInput.type === 'text'
			&& activeInput.placeholder === 'Search tasks...');
		const selStart = wasSearchFocused && activeInput ? activeInput.selectionStart : null;
		const selEnd = wasSearchFocused && activeInput ? activeInput.selectionEnd : null;

		DOM.clearNode(this.contentEl);

		// Stats cards
		this._renderStats();

		// Toolbar: search + filters + New Task button
		this._renderToolbar();

		// Status tabs
		this._renderStatusTabs();

		// Task table
		this._renderTable();

		// Pagination
		this._renderPagination();

		if (wasSearchFocused && this.searchInputEl) {
			this.searchInputEl.focus();
			if (selStart !== null && selEnd !== null) {
				try { this.searchInputEl.setSelectionRange(selStart, selEnd); } catch { /* ignore */ }
			}
		}
	}

	private _renderStats(): void {
		const row = DOM.append(this.contentEl, DOM.$('div'));
		row.style.cssText = 'flex-shrink:0;display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;';

		const card = (label: string, count: number, color: string, icon: string) => {
			const c = DOM.append(row, DOM.$('div'));
			c.style.cssText = `padding:14px 16px;border-radius:8px;background:${color}12;border:1px solid ${color}30;`;
			const top = DOM.append(c, DOM.$('div'));
			top.style.cssText = 'display:flex;align-items:center;gap:8px;';
			const iconEl = DOM.append(top, DOM.$('span'));
			iconEl.textContent = icon;
			iconEl.style.cssText = 'font-size:16px;';
			const lbl = DOM.append(top, DOM.$('span'));
			lbl.textContent = label;
			lbl.style.cssText = 'font-size:12px;color:var(--vscode-descriptionForeground);';
			const num = DOM.append(c, DOM.$('div'));
			num.textContent = String(count);
			num.style.cssText = `font-size:28px;font-weight:700;color:${color};margin-top:4px;`;
		};

		card('Pending', this.stats.pending, '#f59e0b', '\u23F3');
		card('In Progress', this.stats.inProgress, '#3b82f6', '\u25B6');
		card('Completed', this.stats.completed, '#22c55e', '\u2705');
		card('Overdue', this.stats.overdue, '#ef4444', '\u26A0');
	}

	private _renderToolbar(): void {
		const bar = DOM.append(this.contentEl, DOM.$('div'));
		bar.style.cssText = 'flex-shrink:0;display:flex;gap:8px;margin-bottom:12px;align-items:center;';

		const inputStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		// Search
		const search = DOM.append(bar, DOM.$('input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Search tasks...';
		search.value = this.searchQuery;
		search.style.cssText = inputStyle + 'flex:1;min-width:180px;';
		this.searchInputEl = search;
		search.addEventListener('input', () => {
			if (this.searchTimer) { clearTimeout(this.searchTimer); }
			this.searchTimer = setTimeout(() => { this.searchQuery = search.value; this.currentPage = 0; this._loadTasks(); }, 200);
		});
		// Clear button — visible only when search has text. Lets users reset
		// the search with one click instead of selecting + deleting.
		const clearBtn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
		// allow-any-unicode-next-line
		clearBtn.textContent = '×';
		clearBtn.title = 'Clear search';
		clearBtn.style.cssText = `padding:6px 10px;background:transparent;border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-foreground);cursor:pointer;font-size:14px;display:${this.searchQuery ? 'inline-block' : 'none'};`;
		clearBtn.addEventListener('click', () => {
			search.value = '';
			this.searchQuery = '';
			this.currentPage = 0;
			this._loadTasks();
		});

		// Priority filter
		const priFilter = DOM.append(bar, DOM.$('select')) as HTMLSelectElement;
		priFilter.style.cssText = inputStyle + 'cursor:pointer;appearance:auto;';
		const priAll = DOM.append(priFilter, DOM.$('option')) as HTMLOptionElement;
		priAll.value = ''; priAll.textContent = 'All Priorities';
		for (const p of PRIORITIES) {
			const o = DOM.append(priFilter, DOM.$('option')) as HTMLOptionElement;
			o.value = p.value; o.textContent = p.label; o.selected = p.value === this.filterPriority;
		}
		priFilter.addEventListener('change', () => { this.filterPriority = priFilter.value; this.currentPage = 0; this._loadTasks(); });

		// Type filter
		const typeFilter = DOM.append(bar, DOM.$('select')) as HTMLSelectElement;
		typeFilter.style.cssText = inputStyle + 'cursor:pointer;appearance:auto;';
		const typeAll = DOM.append(typeFilter, DOM.$('option')) as HTMLOptionElement;
		typeAll.value = ''; typeAll.textContent = 'All Types';
		for (const t of TASK_TYPES) {
			const o = DOM.append(typeFilter, DOM.$('option')) as HTMLOptionElement;
			o.value = t.value; o.textContent = t.label; o.selected = t.value === this.filterType;
		}
		typeFilter.addEventListener('change', () => { this.filterType = typeFilter.value; this.currentPage = 0; this._loadTasks(); });

		// New Task button
		const addBtn = DOM.append(bar, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ New Task';
		addBtn.style.cssText = 'padding:6px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;white-space:nowrap;';
		addBtn.addEventListener('click', () => this._openForm(null));
	}

	private _renderStatusTabs(): void {
		const tabs = DOM.append(this.contentEl, DOM.$('div'));
		tabs.style.cssText = 'flex-shrink:0;display:flex;gap:0;border-bottom:2px solid var(--vscode-editorWidget-border);margin-bottom:12px;';

		const tabItems: Array<{ label: string; value: string }> = [
			{ label: 'All', value: '' }, { label: 'Pending', value: 'pending' }, { label: 'In Progress', value: 'in_progress' },
			{ label: 'Completed', value: 'completed' }, { label: 'Deferred', value: 'deferred' }, { label: 'Cancelled', value: 'cancelled' }, { label: 'Overdue', value: 'overdue' },
		];

		for (const tab of tabItems) {
			const btn = DOM.append(tabs, DOM.$('button')) as HTMLButtonElement;
			btn.textContent = tab.label;
			const active = this.filterStatus === tab.value;
			btn.style.cssText = `padding:8px 14px;border:none;cursor:pointer;font-size:12px;font-weight:500;border-bottom:2px solid ${active ? 'var(--vscode-focusBorder,#007acc)' : 'transparent'};margin-bottom:-2px;background:none;color:${active ? 'var(--vscode-foreground)' : 'var(--vscode-descriptionForeground)'};`;
			btn.addEventListener('click', () => { this.filterStatus = tab.value; this.currentPage = 0; this._loadTasks(); });
		}
	}

	private _renderTable(): void {
		// Scrollable wrapper — takes remaining flex space so header stays sticky
		// at the top of this wrapper and records scroll inside it (issue #8).
		const tableWrap = DOM.append(this.contentEl, DOM.$('div'));
		tableWrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;scrollbar-width:none;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;';

		if (this.tasks.length === 0) {
			const empty = DOM.append(tableWrap, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No tasks found';
			return;
		}

		// Table header — sticky within tableWrap
		const headerRow = DOM.append(tableWrap, DOM.$('div'));
		headerRow.style.cssText = 'display:grid;grid-template-columns:30px 1fr 90px 120px 120px 90px 80px 90px;gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;border-bottom:1px solid var(--vscode-editorWidget-border);position:sticky;top:0;z-index:2;background:var(--vscode-sideBar-background,var(--vscode-editor-background));';
		for (const col of ['', 'Title', 'Type', 'Assigned To', 'Patient', 'Due', 'Status', 'Actions']) {
			const h = DOM.append(headerRow, DOM.$('span'));
			h.textContent = col;
		}

		// Rows
		for (const task of this.tasks) {
			const row = DOM.append(tableWrap, DOM.$('div'));
			row.style.cssText = 'display:grid;grid-template-columns:30px 1fr 90px 120px 120px 90px 80px 90px;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:center;cursor:pointer;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; });
			row.addEventListener('click', () => this._openForm(task));

			// Priority dot
			const dot = DOM.append(row, DOM.$('span'));
			dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${PRIORITY_COLORS[task.priority] || '#6b7280'};`;

			// Title + description
			const titleCell = DOM.append(row, DOM.$('div'));
			const titleEl = DOM.append(titleCell, DOM.$('div'));
			titleEl.textContent = task.title;
			titleEl.style.cssText = `font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${task.status === 'completed' ? 'text-decoration:line-through;opacity:0.6;' : ''}`;
			if (task.description) {
				const desc = DOM.append(titleCell, DOM.$('div'));
				desc.textContent = task.description;
				desc.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;';
			}

			// Type badge
			const typeBadge = DOM.append(row, DOM.$('span'));
			typeBadge.textContent = typeLabel(task.taskType);
			typeBadge.style.cssText = 'font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(128,128,128,0.15);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

			// Assigned To
			const assigned = DOM.append(row, DOM.$('span'));
			assigned.textContent = task.assignedTo || '--';
			assigned.style.cssText = 'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

			// Patient
			const patient = DOM.append(row, DOM.$('span'));
			patient.textContent = task.patientName || '--';
			patient.style.cssText = 'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

			// Due date
			const due = DOM.append(row, DOM.$('span'));
			due.style.cssText = 'font-size:11px;';
			if (task.dueDate) {
				try {
					const d = new Date(task.dueDate + 'T00:00:00');
					due.textContent = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
					if (d < new Date() && task.status !== 'completed' && task.status !== 'cancelled') {
						due.style.color = '#ef4444';
						due.textContent += ' \u26A0';
					}
				} catch { due.textContent = task.dueDate; }
			} else {
				due.textContent = '--';
			}

			// Status badge
			const statusBadge = DOM.append(row, DOM.$('span'));
			const sc = STATUS_COLORS[task.status] || '#6b7280';
			statusBadge.textContent = statusLabel(task.status);
			statusBadge.style.cssText = `font-size:10px;padding:2px 6px;border-radius:3px;background:${sc}20;color:${sc};font-weight:500;white-space:nowrap;text-transform:capitalize;`;

			// Actions
			const actionsEl = DOM.append(row, DOM.$('div'));
			actionsEl.style.cssText = 'display:flex;gap:4px;';

			// Edit button
			const editBtn = DOM.append(actionsEl, DOM.$('button')) as HTMLButtonElement;
			// allow-any-unicode-next-line
			editBtn.textContent = '\u270F';
			editBtn.title = 'Edit';
			editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:13px;color:var(--vscode-textLink-foreground);padding:2px;';
			editBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this._openForm(task);
			});

			if (task.status !== 'completed' && task.status !== 'cancelled') {
				const completeBtn = DOM.append(actionsEl, DOM.$('button')) as HTMLButtonElement;
				completeBtn.textContent = '\u2713';
				completeBtn.title = 'Complete';
				completeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;color:#22c55e;padding:2px;';
				completeBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					await this.apiService.fetch(`/api/tasks/${task.id}/complete`, { method: 'POST', body: JSON.stringify({ completedBy: 'provider' }) });
					await this._loadAll();
				});
			}

			const delBtn = DOM.append(actionsEl, DOM.$('button')) as HTMLButtonElement;
			// allow-any-unicode-next-line
			delBtn.textContent = '\u{1F5D1}';
			delBtn.title = 'Delete';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:12px;padding:2px;';
			delBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				await this.apiService.fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
				this.notificationService.notify({ severity: Severity.Info, message: `Task "${task.title}" deleted` });
				await this._loadAll();
			});
		}
	}

	private _renderPagination(): void {
		if (this.totalPages <= 1) { return; }
		const bar = DOM.append(this.contentEl, DOM.$('div'));
		bar.style.cssText = 'flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:12px 0 0;border-top:1px solid var(--vscode-editorWidget-border);font-size:12px;color:var(--vscode-descriptionForeground);';

		const info = DOM.append(bar, DOM.$('span'));
		const start = this.currentPage * 20 + 1;
		const end = Math.min(start + 19, this.totalElements);
		info.textContent = `Showing ${start}-${end} of ${this.totalElements} tasks`;

		const btns = DOM.append(bar, DOM.$('div'));
		btns.style.cssText = 'display:flex;gap:8px;align-items:center;';

		const prevBtn = DOM.append(btns, DOM.$('button')) as HTMLButtonElement;
		prevBtn.textContent = '\u25C0 Previous';
		prevBtn.disabled = this.currentPage === 0;
		prevBtn.style.cssText = 'padding:4px 10px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;';
		prevBtn.addEventListener('click', () => { this.currentPage--; this._loadTasks(); });

		const pageInfo = DOM.append(btns, DOM.$('span'));
		pageInfo.textContent = `Page ${this.currentPage + 1} / ${this.totalPages}`;

		const nextBtn = DOM.append(btns, DOM.$('button')) as HTMLButtonElement;
		nextBtn.textContent = 'Next \u25B6';
		nextBtn.disabled = this.currentPage >= this.totalPages - 1;
		nextBtn.style.cssText = 'padding:4px 10px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;cursor:pointer;font-size:11px;';
		nextBtn.addEventListener('click', () => { this.currentPage++; this._loadTasks(); });
	}

	// --- New Task / Edit Task Form Panel ---

	private _openForm(task: Task | null): void {
		if (this.formOverlay) { this.formOverlay.remove(); }

		this.formOverlay = DOM.append(this.root, DOM.$('.task-form-overlay'));
		this.formOverlay.style.cssText = 'position:absolute;inset:0;z-index:100;display:flex;justify-content:flex-end;';

		// Backdrop
		const backdrop = DOM.append(this.formOverlay, DOM.$('div'));
		backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.4);';
		backdrop.addEventListener('click', () => { this.formOverlay?.remove(); this.formOverlay = null; });

		// Panel — flex column so the Cancel/Create button row can stick to the
		// bottom of the panel rather than the bottom of the form content.
		// Issue #6: short forms previously left a large empty gap underneath
		// the buttons because the panel scrolled but the buttons floated
		// against the form's intrinsic height. `overflow-y:auto` still
		// scrolls when the form is taller than the viewport.
		const panel = DOM.append(this.formOverlay, DOM.$('div'));
		panel.style.cssText = 'position:relative;width:520px;max-width:95vw;height:100%;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));border-left:1px solid var(--vscode-editorWidget-border);overflow-y:auto;padding:20px 20px 0;z-index:1;display:flex;flex-direction:column;scrollbar-width:none;';

		// Header
		const hdr = DOM.append(panel, DOM.$('div'));
		hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;';
		const hdrTitle = DOM.append(hdr, DOM.$('h3'));
		hdrTitle.textContent = task ? 'Edit Task' : 'New Task';
		hdrTitle.style.cssText = 'margin:0;font-size:16px;font-weight:600;';
		const closeBtn = DOM.append(hdr, DOM.$('button')) as HTMLButtonElement;
		closeBtn.textContent = '\u2715';
		closeBtn.style.cssText = 'background:none;border:none;font-size:16px;cursor:pointer;color:var(--vscode-foreground);';
		closeBtn.addEventListener('click', () => { this.formOverlay?.remove(); this.formOverlay = null; });

		const inputStyle = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;';

		// Form fields map (for direct access, no querySelector)
		const fields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();

		const addField = (label: string, key: string, type: 'text' | 'textarea' | 'select' | 'number' | 'date' | 'time', opts?: { required?: boolean; placeholder?: string; options?: Array<{ label: string; value: string }>; readonly?: boolean; colSpan?: number }) => {
			const group = DOM.append(panel, DOM.$('div'));
			group.style.cssText = `margin-bottom:12px;${opts?.colSpan === 2 ? '' : ''}`;

			const lbl = DOM.append(group, DOM.$('label'));
			lbl.style.cssText = 'display:block;font-size:12px;font-weight:500;margin-bottom:4px;color:var(--vscode-foreground);';
			lbl.textContent = label + (opts?.required ? ' *' : '');

			const val = task ? String((task as unknown as Record<string, unknown>)[key] ?? '') : '';

			if (type === 'select' && opts?.options) {
				// Custom dropdown — native <select> popups render with OS chrome
				// that on dark themes shows non-highlighted options as faint
				// grey-on-grey (QA-reported unreadable dropdown).
				const sel = createCustomDropdown({
					parent: group,
					options: opts.options,
					initialValue: val,
					placeholder: opts?.placeholder || `Select ${label}...`,
					triggerStyle: inputStyle + 'height:32px;',
				});
				fields.set(key, sel);
			} else if (type === 'textarea') {
				const ta = DOM.append(group, DOM.$('textarea')) as HTMLTextAreaElement;
				ta.value = val; ta.rows = 3;
				ta.placeholder = opts?.placeholder || '';
				ta.style.cssText = inputStyle + 'resize:vertical;';
				fields.set(key, ta);
			} else {
				const inp = DOM.append(group, DOM.$('input')) as HTMLInputElement;
				inp.type = type; inp.value = val;
				inp.placeholder = opts?.placeholder || '';
				inp.readOnly = !!opts?.readonly;
				inp.style.cssText = inputStyle + 'height:32px;';
				fields.set(key, inp);
			}
		};

		// Inline 2-column row helper
		const addRow = (f1: () => void, f2: () => void) => {
			const r = DOM.append(panel, DOM.$('div'));
			r.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;';
			const origPanel = panel;
			// Temporarily redirect addField's parent to the row
			(this as { _formRowParent?: HTMLElement })._formRowParent = r;
			// We'll just call the functions which append to panel — but we need inline rows
			// Use a simpler approach: just create fields inline
			(this as { _formRowParent?: HTMLElement })._formRowParent = undefined;
			// Clean approach: return the row element
			f1();
			f2();
			// Move last 2 children from panel to row
			const children = Array.from(origPanel.children);
			const last2 = children.slice(-2);
			for (const c of last2) { r.appendChild(c); }
		};

		// --- Form Fields ---
		addField('Title', 'title', 'text', { required: true, placeholder: 'Enter task title' });
		addField('Description', 'description', 'textarea', { placeholder: 'Task description...' });

		addRow(
			() => addField('Task Type', 'taskType', 'select', { options: TASK_TYPES }),
			() => addField('Priority', 'priority', 'select', { options: PRIORITIES }),
		);

		addField('Status', 'status', 'select', { options: STATUSES });

		addRow(
			() => addField('Due Date', 'dueDate', 'date'),
			() => addField('Due Time', 'dueTime', 'time'),
		);

		addRow(
			() => addField('Assigned To', 'assignedTo', 'text', { required: true, placeholder: 'Search provider...' }),
			() => addField('Assigned By', 'assignedBy', 'text', { placeholder: 'e.g. Front Desk' }),
		);

		addRow(
			() => addField('Patient Name', 'patientName', 'text', { required: true, placeholder: 'Search patient by name...' }),
			() => addField('Patient ID', 'patientId', 'text', { placeholder: 'Auto-filled from search', readonly: true }),
		);

		// Provider search autocomplete on assignedTo. Dropdown is body-mounted
		// with position:fixed so it never overlaps the form fields below the
		// input (QA-reported "Michael John overlapping Priority" bug).
		const assignedToInput = fields.get('assignedTo') as HTMLInputElement;
		if (assignedToInput && assignedToInput.parentElement) {
			const provOwnerDoc = assignedToInput.ownerDocument || document;
			const provDropdown = provOwnerDoc.createElement('div');
			provDropdown.style.cssText = 'position:fixed;max-height:220px;overflow-y:auto;background:var(--vscode-editorWidget-background,#1e1e1e);color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,0.35));border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.45);z-index:10000;display:none;';
			provOwnerDoc.body.appendChild(provDropdown);
			const positionProvDropdown = () => {
				const rect = assignedToInput.getBoundingClientRect();
				provDropdown.style.left = `${rect.left}px`;
				provDropdown.style.top = `${rect.bottom + 2}px`;
				provDropdown.style.width = `${rect.width}px`;
			};
			const repositionProv = () => { if (provDropdown.style.display === 'block') { positionProvDropdown(); } };
			const provWin = provOwnerDoc.defaultView;
			provWin?.addEventListener('scroll', repositionProv, true);
			provWin?.addEventListener('resize', repositionProv);
			// Detach the body-mounted dropdown when the input leaves the DOM
			// (form closed) so we don't leak listeners or orphan elements.
			const provObserver = new MutationObserver(() => {
				if (!assignedToInput.isConnected) {
					provObserver.disconnect();
					provWin?.removeEventListener('scroll', repositionProv, true);
					provWin?.removeEventListener('resize', repositionProv);
					if (provDropdown.parentElement) { provDropdown.parentElement.removeChild(provDropdown); }
				}
			});
			if (assignedToInput.parentNode?.parentNode) { provObserver.observe(assignedToInput.parentNode.parentNode, { childList: true, subtree: true }); }
			const showProvDropdown = () => { positionProvDropdown(); provDropdown.style.display = 'block'; };
			let provTimer: ReturnType<typeof setTimeout> | undefined;
			assignedToInput.addEventListener('input', () => {
				if (provTimer) { clearTimeout(provTimer); }
				const q = assignedToInput.value.trim();
				if (q.length < 2) { provDropdown.style.display = 'none'; return; }
				provTimer = setTimeout(async () => {
					try {
						const res = await this.apiService.fetch(`/api/providers?search=${encodeURIComponent(q)}&page=0&size=10`);
						if (!res.ok) { return; }
						const data = await res.json();
						const list = data?.data?.content || data?.content || data?.data || [];
						DOM.clearNode(provDropdown);
						for (const p of list) {
							const item = DOM.append(provDropdown, DOM.$('div'));
							item.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);';
							const fn = String(p.firstName || p['identification.firstName'] || '');
							const ln = String(p.lastName || p['identification.lastName'] || '');
							item.textContent = `${fn} ${ln}`.trim() || String(p.name || p.username || p.id || '');
							item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
							item.addEventListener('mouseleave', () => { item.style.background = ''; });
							item.addEventListener('click', () => {
								assignedToInput.value = item.textContent || '';
								provDropdown.style.display = 'none';
							});
						}
						if (list.length > 0) { showProvDropdown(); } else { provDropdown.style.display = 'none'; }
					} catch { /* ignore */ }
				}, 250);
			});
			assignedToInput.addEventListener('blur', () => { setTimeout(() => { provDropdown.style.display = 'none'; }, 150); });
		}

		// Patient search autocomplete. Body-mounted with position:fixed so
		// the match list never collides with form fields below.
		const patNameInput = fields.get('patientName') as HTMLInputElement;
		const patIdInput = fields.get('patientId') as HTMLInputElement;
		if (patNameInput && patIdInput) {
			const patOwnerDoc = patNameInput.ownerDocument || document;
			const dropdown = patOwnerDoc.createElement('div');
			dropdown.style.cssText = 'position:fixed;max-height:220px;overflow-y:auto;background:var(--vscode-editorWidget-background,#1e1e1e);color:var(--vscode-foreground);border:1px solid var(--vscode-editorWidget-border,rgba(255,255,255,0.35));border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,0.45);z-index:10000;display:none;';
			patOwnerDoc.body.appendChild(dropdown);
			const positionPatDropdown = () => {
				const rect = patNameInput.getBoundingClientRect();
				dropdown.style.left = `${rect.left}px`;
				dropdown.style.top = `${rect.bottom + 2}px`;
				dropdown.style.width = `${rect.width}px`;
			};
			const repositionPat = () => { if (dropdown.style.display === 'block') { positionPatDropdown(); } };
			const patWin = patOwnerDoc.defaultView;
			patWin?.addEventListener('scroll', repositionPat, true);
			patWin?.addEventListener('resize', repositionPat);
			const patObserver = new MutationObserver(() => {
				if (!patNameInput.isConnected) {
					patObserver.disconnect();
					patWin?.removeEventListener('scroll', repositionPat, true);
					patWin?.removeEventListener('resize', repositionPat);
					if (dropdown.parentElement) { dropdown.parentElement.removeChild(dropdown); }
				}
			});
			if (patNameInput.parentNode?.parentNode) { patObserver.observe(patNameInput.parentNode.parentNode, { childList: true, subtree: true }); }
			const showPatDropdown = () => { positionPatDropdown(); dropdown.style.display = 'block'; };

			let timer: ReturnType<typeof setTimeout> | undefined;
			patNameInput.addEventListener('input', () => {
				if (timer) { clearTimeout(timer); }
				const q = patNameInput.value;
				if (q.length < 2) { dropdown.style.display = 'none'; return; }
				timer = setTimeout(async () => {
					try {
						const res = await this.apiService.fetch(`/api/patients?search=${encodeURIComponent(q)}&page=0&size=10`);
						if (res.ok) {
							const data = await res.json();
							const patients = data?.data?.content || data?.content || [];
							DOM.clearNode(dropdown);
							for (const p of patients) {
								const item = DOM.append(dropdown, DOM.$('div'));
								item.style.cssText = 'padding:6px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(128,128,128,0.1);';
								item.textContent = `${p.firstName || ''} ${p.lastName || ''} — ID: ${p.id || ''}`;
								item.addEventListener('mouseenter', () => { item.style.background = 'var(--vscode-list-hoverBackground)'; });
								item.addEventListener('mouseleave', () => { item.style.background = ''; });
								item.addEventListener('click', () => {
									patNameInput.value = `${p.firstName || ''} ${p.lastName || ''}`.trim();
									patIdInput.value = p.id || '';
									dropdown.style.display = 'none';
								});
							}
							if (patients.length > 0) { showPatDropdown(); } else { dropdown.style.display = 'none'; }
						}
					} catch { /* */ }
				}, 250);
			});
		}

		addField('Encounter ID', 'encounterId', 'text', { placeholder: 'Encounter ID (optional)' });

		addRow(
			() => addField('Reference Type', 'referenceType', 'text', { placeholder: 'e.g. Order, Lab' }),
			() => addField('Reference ID', 'referenceId', 'text', { placeholder: 'Reference ID (numeric)' }),
		);

		addField('Notes', 'notes', 'textarea', { placeholder: 'Additional notes...' });

		// Buttons
		const btnRow = DOM.append(panel, DOM.$('div'));
		// `margin-top:auto` in the flex-column panel pushes the action row to
		// the bottom — fills the empty gap that previously appeared under the
		// buttons on short forms (Issue #6). flex-shrink:0 keeps the row
		// fully visible even when the form scrolls.
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:auto;padding:16px 0 20px;border-top:1px solid var(--vscode-editorWidget-border);position:sticky;bottom:0;background:var(--vscode-sideBar-background,var(--vscode-editor-background,#252526));';

		// Delete button on the left, only shown for existing tasks
		const leftGroup = DOM.append(btnRow, DOM.$('div'));
		leftGroup.style.cssText = 'display:flex;gap:8px;';
		if (task) {
			const deleteBtn = DOM.append(leftGroup, DOM.$('button')) as HTMLButtonElement;
			deleteBtn.textContent = 'Delete';
			deleteBtn.style.cssText = 'padding:8px 20px;background:transparent;color:#ef4444;border:1px solid #ef4444;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
			deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = 'rgba(239,68,68,0.1)'; });
			deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = 'transparent'; });
			deleteBtn.addEventListener('click', async () => {
				if (!task.id) { return; }
				deleteBtn.disabled = true;
				deleteBtn.textContent = 'Deleting...';
				try {
					const res = await this.apiService.fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
					if (res.ok) {
						this.formOverlay?.remove();
						this.formOverlay = null;
						this.notificationService.notify({ severity: Severity.Info, message: `Task "${task.title}" deleted` });
						await this._loadAll();
					} else {
						this.notificationService.notify({ severity: Severity.Error, message: 'Failed to delete task' });
						deleteBtn.disabled = false;
						deleteBtn.textContent = 'Delete';
					}
				} catch {
					this.notificationService.notify({ severity: Severity.Error, message: 'Error deleting task' });
					deleteBtn.disabled = false;
					deleteBtn.textContent = 'Delete';
				}
			});
		}

		const rightGroup = DOM.append(btnRow, DOM.$('div'));
		rightGroup.style.cssText = 'display:flex;gap:8px;';

		const cancelBtn = DOM.append(rightGroup, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:8px 20px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => { this.formOverlay?.remove(); this.formOverlay = null; });

		const saveBtn = DOM.append(rightGroup, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = task ? 'Save Changes' : 'Create';
		saveBtn.style.cssText = 'padding:8px 20px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
		// Per-field error element, created lazily and reused across re-validations
		// so we don't rely on querySelector (project linter forbids selector-based
		// lookups — track the element directly instead).
		const fieldErrors = new Map<string, HTMLElement>();
		const showFieldError = (key: string, input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, message: string) => {
			input.style.borderColor = '#ef4444';
			input.focus();
			let errEl = fieldErrors.get(key);
			if (!errEl && input.parentElement) {
				errEl = DOM.append(input.parentElement, DOM.$('div.field-error'));
				errEl.style.cssText = 'color:#ef4444;font-size:11px;margin-top:4px;';
				fieldErrors.set(key, errEl);
			}
			if (errEl) { errEl.textContent = message; errEl.style.display = 'block'; }
			input.addEventListener('input', () => {
				input.style.borderColor = '';
				const e = fieldErrors.get(key);
				if (e) { e.style.display = 'none'; }
			}, { once: true });
		};

		saveBtn.addEventListener('click', async () => {
			const titleInput = fields.get('title') as HTMLInputElement;
			const title = titleInput?.value?.trim();
			if (!title) {
				showFieldError('title', titleInput, 'Title is required');
				this.notificationService.notify({ severity: Severity.Warning, message: 'Title is required' });
				return;
			}
			if (title.length < 3) {
				showFieldError('title', titleInput, 'Title must be at least 3 characters');
				this.notificationService.notify({ severity: Severity.Warning, message: 'Title must be at least 3 characters' });
				return;
			}
			// Validate text fields reject special characters and surface the
			// offending field with a red border (matches base-class behaviour
			// from clinicalListEditor.ts).
			const textValidation: Array<{ key: string; label: string }> = [
				{ key: 'title', label: 'Title' },
				{ key: 'assignedTo', label: 'Assigned To' },
				{ key: 'assignedBy', label: 'Assigned By' },
				{ key: 'patientName', label: 'Patient Name' },
			];
			const textPattern = /^[A-Za-z0-9 ,.'\-()@/]{1,256}$/;
			for (const { key, label } of textValidation) {
				const input = fields.get(key) as HTMLInputElement | undefined;
				const v = input?.value?.trim() || '';
				if (v && !textPattern.test(v)) {
					if (input) {
						showFieldError(key, input, `${label} contains invalid characters`);
					}
					this.notificationService.notify({ severity: Severity.Warning, message: `${label} contains invalid characters. Use only letters, numbers, spaces, and common punctuation.` });
					return;
				}
			}

			const payload: Record<string, unknown> = {};
			for (const [key, el] of fields) {
				const v = el.value?.trim();
				if (v) { payload[key] = v; }
			}

			// Defaults
			if (!payload['taskType']) { payload['taskType'] = 'general'; }
			if (!payload['priority']) { payload['priority'] = 'normal'; }
			if (!payload['status']) { payload['status'] = 'pending'; }

			saveBtn.disabled = true;
			saveBtn.textContent = 'Saving...';

			try {
				const url = task ? `/api/tasks/${task.id}` : '/api/tasks';
				const method = task ? 'PUT' : 'POST';
				const res = await this.apiService.fetch(url, { method, body: JSON.stringify(payload) });
				if (res.ok) {
					this.formOverlay?.remove();
					this.formOverlay = null;
					this.notificationService.notify({ severity: Severity.Info, message: task ? 'Task updated' : 'Task created' });
					await this._loadAll();
				} else {
					this.notificationService.notify({ severity: Severity.Error, message: 'Failed to save task' });
					saveBtn.disabled = false;
					saveBtn.textContent = task ? 'Save Changes' : 'Create';
				}
			} catch {
				this.notificationService.notify({ severity: Severity.Error, message: 'Error saving task' });
				saveBtn.disabled = false;
				saveBtn.textContent = task ? 'Save Changes' : 'Create';
			}
		});
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}

	override dispose(): void {
		if (this.searchTimer) { clearTimeout(this.searchTimer); }
		super.dispose();
	}
}
