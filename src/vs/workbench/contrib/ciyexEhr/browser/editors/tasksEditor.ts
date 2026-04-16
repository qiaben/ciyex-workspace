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
		this.root = DOM.append(parent, DOM.$('.tasks-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;position:relative;';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:1100px;margin:0 auto;padding:20px 24px;';
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
			if (!res.ok) { return; }
			const data = await res.json();
			const page = data?.data || data || {};
			this.tasks = (page.content || []) as Task[];
			this.totalPages = page.totalPages || 1;
			this.totalElements = page.totalElements || this.tasks.length;
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login...';
		}
	}

	private _render(): void {
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
	}

	private _renderStats(): void {
		const row = DOM.append(this.contentEl, DOM.$('div'));
		row.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;';

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
		bar.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;align-items:center;';

		const inputStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;';

		// Search
		const search = DOM.append(bar, DOM.$('input')) as HTMLInputElement;
		search.type = 'text';
		search.placeholder = 'Search tasks...';
		search.value = this.searchQuery;
		search.style.cssText = inputStyle + 'flex:1;min-width:180px;';
		let searchTimer: ReturnType<typeof setTimeout> | undefined;
		search.addEventListener('input', () => {
			if (searchTimer) { clearTimeout(searchTimer); }
			searchTimer = setTimeout(() => { this.searchQuery = search.value; this.currentPage = 0; this._loadTasks(); }, 300);
		});

		// Priority filter
		const priFilter = DOM.append(bar, DOM.$('select')) as HTMLSelectElement;
		priFilter.style.cssText = inputStyle + 'cursor:pointer;';
		const priAll = DOM.append(priFilter, DOM.$('option')) as HTMLOptionElement;
		priAll.value = ''; priAll.textContent = 'All Priorities';
		for (const p of PRIORITIES) {
			const o = DOM.append(priFilter, DOM.$('option')) as HTMLOptionElement;
			o.value = p.value; o.textContent = p.label; o.selected = p.value === this.filterPriority;
		}
		priFilter.addEventListener('change', () => { this.filterPriority = priFilter.value; this.currentPage = 0; this._loadTasks(); });

		// Type filter
		const typeFilter = DOM.append(bar, DOM.$('select')) as HTMLSelectElement;
		typeFilter.style.cssText = inputStyle + 'cursor:pointer;';
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
		tabs.style.cssText = 'display:flex;gap:0;border-bottom:2px solid var(--vscode-editorWidget-border);margin-bottom:12px;';

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
		if (this.tasks.length === 0) {
			const empty = DOM.append(this.contentEl, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No tasks found';
			return;
		}

		// Table header
		const table = DOM.append(this.contentEl, DOM.$('div'));
		const headerRow = DOM.append(table, DOM.$('div'));
		headerRow.style.cssText = 'display:grid;grid-template-columns:30px 1fr 90px 120px 120px 90px 80px 70px;gap:8px;padding:8px 12px;font-size:11px;font-weight:600;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.3px;border-bottom:1px solid var(--vscode-editorWidget-border);';
		for (const col of ['', 'Title', 'Type', 'Assigned To', 'Patient', 'Due', 'Status', '']) {
			const h = DOM.append(headerRow, DOM.$('span'));
			h.textContent = col;
		}

		// Rows
		for (const task of this.tasks) {
			const row = DOM.append(table, DOM.$('div'));
			row.style.cssText = 'display:grid;grid-template-columns:30px 1fr 90px 120px 120px 90px 80px 70px;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(128,128,128,0.1);align-items:center;cursor:pointer;';
			row.addEventListener('mouseenter', () => { row.style.background = 'var(--vscode-list-hoverBackground)'; actionsEl.style.opacity = '1'; });
			row.addEventListener('mouseleave', () => { row.style.background = ''; actionsEl.style.opacity = '0'; });
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
					due.textContent = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
			actionsEl.style.cssText = 'display:flex;gap:4px;opacity:0;transition:opacity 0.1s;';

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
		bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:12px;color:var(--vscode-descriptionForeground);';

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

		// Panel
		const panel = DOM.append(this.formOverlay, DOM.$('div'));
		panel.style.cssText = 'position:relative;width:480px;max-width:90%;height:100%;background:var(--vscode-editorWidget-background,#252526);border-left:1px solid var(--vscode-editorWidget-border);overflow-y:auto;padding:20px;z-index:1;';

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
				const sel = DOM.append(group, DOM.$('select')) as HTMLSelectElement;
				sel.style.cssText = inputStyle + 'height:32px;cursor:pointer;';
				for (const o of opts.options) {
					const opt = DOM.append(sel, DOM.$('option')) as HTMLOptionElement;
					opt.value = o.value; opt.textContent = o.label; opt.selected = o.value === val;
				}
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

		// Patient search autocomplete
		const patNameInput = fields.get('patientName') as HTMLInputElement;
		const patIdInput = fields.get('patientId') as HTMLInputElement;
		if (patNameInput && patIdInput) {
			const resultsDiv = DOM.append(patNameInput.parentElement!, DOM.$('div'));
			resultsDiv.style.cssText = 'position:relative;';
			const dropdown = DOM.append(resultsDiv, DOM.$('div'));
			dropdown.style.cssText = 'position:absolute;top:0;left:0;right:0;max-height:150px;overflow-y:auto;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-editorWidget-border);border-radius:4px;z-index:10;display:none;';

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
							dropdown.style.display = patients.length > 0 ? 'block' : 'none';
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
		btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--vscode-editorWidget-border);';

		const cancelBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:8px 20px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => { this.formOverlay?.remove(); this.formOverlay = null; });

		const saveBtn = DOM.append(btnRow, DOM.$('button')) as HTMLButtonElement;
		saveBtn.textContent = task ? 'Save Changes' : 'Create';
		saveBtn.style.cssText = 'padding:8px 20px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;';
		saveBtn.addEventListener('click', async () => {
			const title = (fields.get('title') as HTMLInputElement)?.value?.trim();
			if (!title) {
				this.notificationService.notify({ severity: Severity.Warning, message: 'Title is required' });
				return;
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
}
