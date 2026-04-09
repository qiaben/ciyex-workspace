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
import { TasksEditorInput } from './ciyexEditorInput.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import * as DOM from '../../../../../base/browser/dom.js';

interface Task {
	id: string;
	title: string;
	description?: string;
	status: string;
	priority: string;
	assignedTo?: string;
	assignedToName?: string;
	dueDate?: string;
	patientId?: string;
	patientName?: string;
	createdAt: string;
}

const PRIORITY_COLORS: Record<string, string> = {
	high: '#ef4444', urgent: '#ef4444',
	medium: '#f59e0b', normal: '#f59e0b',
	low: '#22c55e',
};

const STATUS_ICONS: Record<string, string> = {
	pending: '⏳', 'in-progress': '🔄', completed: '✅', overdue: '🔴', cancelled: '❌',
};

export class TasksEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexTasks';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;
	private tasks: Task[] = [];
	private filterStatus = '';
	private filterPriority = '';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
	) {
		super(TasksEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.tasks-editor'));
		this.root.style.cssText = 'height:100%;overflow-y:auto;background:var(--vscode-editor-background);';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'max-width:900px;margin:0 auto;padding:20px 24px;';
	}

	override async setInput(input: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		if (!(input instanceof TasksEditorInput)) { return; }
		await this._loadTasks();
	}

	private async _loadTasks(): Promise<void> {
		try {
			let url = '/api/tasks?page=0&size=50';
			if (this.filterStatus) { url += `&status=${this.filterStatus}`; }
			if (this.filterPriority) { url += `&priority=${this.filterPriority}`; }
			const res = await this.apiService.fetch(url);
			if (!res.ok) { this.contentEl.textContent = 'Failed to load tasks.'; return; }
			const data = await res.json();
			this.tasks = (data?.data?.content || data?.data || data?.content || data || []) as Task[];
			this._render();
		} catch {
			this.contentEl.textContent = 'Waiting for login...';
		}
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		const title = DOM.append(this.contentEl, DOM.$('h2'));
		title.textContent = 'Tasks';
		title.style.cssText = 'font-size:20px;font-weight:600;margin:0 0 16px;';

		// Toolbar
		const toolbar = DOM.append(this.contentEl, DOM.$('div'));
		toolbar.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;align-items:center;';

		const selectStyle = 'padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:4px;color:var(--vscode-input-foreground);font-size:12px;cursor:pointer;';

		// Status filter
		const statusFilter = DOM.append(toolbar, DOM.$('select')) as HTMLSelectElement;
		statusFilter.style.cssText = selectStyle;
		for (const [label, value] of [['All Status', ''], ['Pending', 'pending'], ['In Progress', 'in-progress'], ['Completed', 'completed'], ['Overdue', 'overdue']]) {
			const o = DOM.append(statusFilter, DOM.$('option')) as HTMLOptionElement;
			o.value = value; o.textContent = label;
		}
		statusFilter.addEventListener('change', () => { this.filterStatus = statusFilter.value; this._loadTasks(); });

		// Priority filter
		const priorityFilter = DOM.append(toolbar, DOM.$('select')) as HTMLSelectElement;
		priorityFilter.style.cssText = selectStyle;
		for (const [label, value] of [['All Priority', ''], ['High', 'high'], ['Medium', 'medium'], ['Low', 'low']]) {
			const o = DOM.append(priorityFilter, DOM.$('option')) as HTMLOptionElement;
			o.value = value; o.textContent = label;
		}
		priorityFilter.addEventListener('change', () => { this.filterPriority = priorityFilter.value; this._loadTasks(); });

		DOM.append(toolbar, DOM.$('span')).style.flex = '1';

		const addBtn = DOM.append(toolbar, DOM.$('button'));
		addBtn.textContent = '+ New Task';
		addBtn.style.cssText = 'padding:6px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;';
		addBtn.addEventListener('click', () => this._addTask());

		// Task list
		if (this.tasks.length === 0) {
			const empty = DOM.append(this.contentEl, DOM.$('div'));
			empty.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			empty.textContent = 'No tasks';
			return;
		}

		for (const task of this.tasks) {
			const card = DOM.append(this.contentEl, DOM.$('div'));
			card.style.cssText = 'padding:12px 16px;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;margin-bottom:8px;display:flex;align-items:flex-start;gap:10px;';
			card.addEventListener('mouseenter', () => { card.style.background = 'var(--vscode-list-hoverBackground)'; });
			card.addEventListener('mouseleave', () => { card.style.background = ''; });

			// Priority indicator
			const dot = DOM.append(card, DOM.$('span'));
			dot.style.cssText = `width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:4px;background:${PRIORITY_COLORS[task.priority] || '#6b7280'};`;

			// Content
			const col = DOM.append(card, DOM.$('div'));
			col.style.cssText = 'flex:1;min-width:0;';

			const titleRow = DOM.append(col, DOM.$('div'));
			titleRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
			const statusIcon = DOM.append(titleRow, DOM.$('span'));
			statusIcon.textContent = STATUS_ICONS[task.status] || '○';
			const titleEl = DOM.append(titleRow, DOM.$('span'));
			titleEl.textContent = task.title;
			titleEl.style.cssText = `font-weight:500;${task.status === 'completed' ? 'text-decoration:line-through;opacity:0.6;' : ''}`;

			const meta = DOM.append(col, DOM.$('div'));
			meta.style.cssText = 'font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px;';
			const parts = [];
			if (task.assignedToName) { parts.push(`→ ${task.assignedToName}`); }
			if (task.patientName) { parts.push(`Patient: ${task.patientName}`); }
			if (task.dueDate) { parts.push(`Due: ${task.dueDate}`); }
			meta.textContent = parts.join(' · ');

			// Actions
			const actions = DOM.append(card, DOM.$('div'));
			actions.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';

			if (task.status !== 'completed') {
				const completeBtn = DOM.append(actions, DOM.$('button'));
				completeBtn.textContent = '✓';
				completeBtn.title = 'Complete';
				completeBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:16px;color:#22c55e;padding:2px;';
				completeBtn.addEventListener('click', async () => {
					await this.apiService.fetch(`/api/tasks/${task.id}/status`, {
						method: 'PUT',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ status: 'completed' }),
					});
					this._loadTasks();
				});
			}

			const delBtn = DOM.append(actions, DOM.$('button'));
			delBtn.textContent = '🗑️';
			delBtn.title = 'Delete';
			delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:14px;padding:2px;';
			delBtn.addEventListener('click', async () => {
				if (confirm(`Delete task "${task.title}"?`)) {
					await this.apiService.fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
					this._loadTasks();
				}
			});
		}
	}

	private async _addTask(): Promise<void> {
		const taskTitle = prompt('Task title:');
		if (!taskTitle) { return; }
		const priority = prompt('Priority (high/medium/low):', 'medium');

		try {
			await this.apiService.fetch('/api/tasks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: taskTitle, priority: priority || 'medium', status: 'pending' }),
			});
			this._loadTasks();
		} catch { /* */ }
	}

	override layout(dimension: DOM.Dimension): void {
		this.root.style.height = `${dimension.height}px`;
		this.root.style.width = `${dimension.width}px`;
	}
}
