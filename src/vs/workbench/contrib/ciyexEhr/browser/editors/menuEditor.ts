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
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { BaseCiyexInput } from './ciyexEditorInput.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import * as DOM from '../../../../../base/browser/dom.js';

/**
 * Menu Configuration editor — mirrors the EHR Web UI at
 * `/settings/menu-configuration`. Backed by the `/api/menus/ehr-sidebar`
 * endpoint family (overrides on top of the global default tree). The previous
 * file-based JSON editor was deliberately replaced because it diverged from
 * production behaviour — practices need the same hide / modify / reorder /
 * add / reset semantics the web UI exposes.
 */

interface MenuItemFlat {
	id: string;
	parentId: string | null;
	itemKey: string;
	label: string;
	icon: string | null;
	screenSlug: string | null;
	position: number;
	isCustom?: boolean;
	isModified?: boolean;
	isReordered?: boolean;
}

interface Override {
	id: string;
	orgId?: string;
	menuCode?: string;
	itemId: string | null;
	action: string;
	data: string | null;
}

interface MenuItemNode {
	item: {
		id: string;
		itemKey: string;
		label: string;
		icon: string | null;
		screenSlug: string | null;
		position: number;
	};
	children?: MenuItemNode[] | null;
}

export class MenuEditor extends EditorPane {
	static readonly ID = 'workbench.editor.ciyexMenu';

	private root!: HTMLElement;
	private contentEl!: HTMLElement;

	private items: MenuItemFlat[] = [];
	private hiddenItems: MenuItemFlat[] = [];
	private overrides: Override[] = [];
	private hasCustom: boolean = false;
	private loading: boolean = true;
	private expanded: Set<string> = new Set();
	private editingId: string | null = null;
	private editForm = { label: '', icon: '', screenSlug: '', fhirResources: '' };
	private showAddForm: boolean = false;
	private addParentId: string | null = null;
	private newItem = { label: '', icon: 'FileText', screenSlug: '', itemKey: '', fhirResources: '' };
	private showHidden: boolean = false;
	private showCode: boolean = false;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICiyexApiService private readonly apiService: ICiyexApiService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(MenuEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		this.root = DOM.append(parent, DOM.$('.ciyex-menu-editor.ciyex-editor-root'));
		this.root.style.cssText = 'height:100%;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font-size:13px;overflow:hidden;';
		this.contentEl = DOM.append(this.root, DOM.$('div'));
		this.contentEl.style.cssText = 'flex:1;overflow-y:auto;';
	}

	override async setInput(input: BaseCiyexInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);
		await this._loadMenu();
		if (!token.isCancellationRequested) { this._render(); }
	}

	private async _loadMenu(): Promise<void> {
		this.loading = true;
		this._render();
		try {
			const practiceType = (typeof localStorage !== 'undefined') ? localStorage.getItem('practiceType') : null;
			const ptParam = practiceType ? `?practiceType=${encodeURIComponent(practiceType)}` : '';
			const [overridesRes, customRes, menuRes] = await Promise.all([
				this.apiService.fetch('/api/menus/ehr-sidebar/overrides'),
				this.apiService.fetch('/api/menus/ehr-sidebar/has-custom'),
				this.apiService.fetch(`/api/menus/ehr-sidebar${ptParam}`),
			]);
			const overridesData = overridesRes.ok ? await overridesRes.json() : [];
			const customData = customRes.ok ? await customRes.json() : { hasCustom: false };
			const menuData = menuRes.ok ? await menuRes.json() : { items: [], menu: {} };

			this.overrides = Array.isArray(overridesData) ? overridesData as Override[] : [];
			this.hasCustom = !!customData?.hasCustom;

			const hiddenIds = new Set(this.overrides.filter(o => o.action === 'hide').map(o => o.itemId));
			const modifiedIds = new Set(this.overrides.filter(o => o.action === 'modify').map(o => o.itemId));
			const reorderedIds = new Set(this.overrides.filter(o => o.action === 'reorder').map(o => o.itemId));
			const customItemIds = new Set(this.overrides.filter(o => o.action === 'add').map(o => o.id));

			const flat: MenuItemFlat[] = [];
			const flatten = (nodes: MenuItemNode[], parentId: string | null): void => {
				for (const n of nodes) {
					flat.push({
						id: n.item.id,
						parentId,
						itemKey: n.item.itemKey,
						label: n.item.label,
						icon: n.item.icon,
						screenSlug: n.item.screenSlug,
						position: n.item.position,
						isCustom: customItemIds.has(n.item.id),
						isModified: modifiedIds.has(n.item.id),
						isReordered: reorderedIds.has(n.item.id),
					});
					if (n.children?.length) { flatten(n.children, n.item.id); }
				}
			};
			flatten(menuData.items || [], null);
			this.items = flat;

			// Resolve labels for hidden items by fetching the global tree
			if (hiddenIds.size > 0) {
				try {
					const globalRes = await this.apiService.fetch('/api/menus/ehr-sidebar');
					if (globalRes.ok) {
						const globalData = await globalRes.json();
						const globalFlat: MenuItemFlat[] = [];
						const flattenG = (nodes: MenuItemNode[], parentId: string | null): void => {
							for (const n of nodes) {
								globalFlat.push({
									id: n.item.id,
									parentId,
									itemKey: n.item.itemKey,
									label: n.item.label,
									icon: n.item.icon,
									screenSlug: n.item.screenSlug,
									position: n.item.position,
								});
								if (n.children?.length) { flattenG(n.children, n.item.id); }
							}
						};
						flattenG(globalData.items || [], null);
						this.hiddenItems = globalFlat.filter(i => hiddenIds.has(i.id));
					}
				} catch { this.hiddenItems = []; }
			} else {
				this.hiddenItems = [];
			}

			// Expand top-level items by default the first time we load.
			if (this.expanded.size === 0) {
				for (const it of flat) {
					if (!it.parentId) { this.expanded.add(it.id); }
				}
			}
		} catch (e) {
			this.notificationService.notify({ severity: Severity.Error, message: `Failed to load menu: ${e}` });
		} finally {
			this.loading = false;
		}
	}

	private _render(): void {
		DOM.clearNode(this.contentEl);

		const wrap = DOM.append(this.contentEl, DOM.$('div'));
		wrap.style.cssText = 'max-width:1100px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:18px;';

		// Header
		const header = DOM.append(wrap, DOM.$('div'));
		header.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:16px;';
		const headLeft = DOM.append(header, DOM.$('div'));
		const h1 = DOM.append(headLeft, DOM.$('h1'));
		h1.textContent = 'Menu Configuration';
		h1.style.cssText = 'margin:0 0 4px;font-size:20px;font-weight:600;';
		const sub = DOM.append(headLeft, DOM.$('p'));
		sub.textContent = 'Customize the sidebar navigation for your organization';
		sub.style.cssText = 'margin:0;color:var(--vscode-descriptionForeground);font-size:13px;';

		const headRight = DOM.append(header, DOM.$('div'));
		headRight.style.cssText = 'display:flex;align-items:center;gap:8px;';
		const codeBtn = DOM.append(headRight, DOM.$('button')) as HTMLButtonElement;
		codeBtn.textContent = '</> Code';
		codeBtn.title = 'Toggle JSON view';
		codeBtn.style.cssText = `padding:6px 10px;border:1px solid ${this.showCode ? '#93c5fd' : 'var(--vscode-input-border,#3c3c3c)'};background:${this.showCode ? 'rgba(59,130,246,0.12)' : 'transparent'};color:${this.showCode ? '#3b82f6' : 'var(--vscode-foreground)'};border-radius:6px;cursor:pointer;font-size:12px;font-weight:500;`;
		codeBtn.addEventListener('click', () => { this.showCode = !this.showCode; this._render(); });
		const stateBadge = DOM.append(headRight, DOM.$('span'));
		stateBadge.textContent = this.hasCustom ? 'Customized' : 'Default';
		stateBadge.style.cssText = `padding:3px 8px;font-size:11px;font-weight:600;border-radius:4px;background:${this.hasCustom ? 'rgba(59,130,246,0.15)' : 'rgba(148,163,184,0.15)'};color:${this.hasCustom ? '#3b82f6' : 'var(--vscode-descriptionForeground)'};`;

		if (this.loading) {
			const loadEl = DOM.append(wrap, DOM.$('div'));
			loadEl.textContent = 'Loading menu…';
			loadEl.style.cssText = 'padding:40px;text-align:center;color:var(--vscode-descriptionForeground);';
			return;
		}

		// Split layout when Code panel is shown
		const splitWrap = DOM.append(wrap, DOM.$('div'));
		splitWrap.style.cssText = this.showCode ? 'display:flex;gap:16px;align-items:flex-start;' : '';

		if (this.showCode) {
			const codePanel = DOM.append(splitWrap, DOM.$('div'));
			codePanel.style.cssText = 'width:50%;flex-shrink:0;border:1px solid var(--vscode-editorWidget-border);border-radius:8px;overflow:hidden;';
			const codeHeader = DOM.append(codePanel, DOM.$('div'));
			codeHeader.textContent = 'menu.json (resolved)';
			codeHeader.style.cssText = 'padding:8px 12px;font-size:11px;font-weight:600;letter-spacing:0.4px;text-transform:uppercase;color:var(--vscode-descriptionForeground);border-bottom:1px solid var(--vscode-editorWidget-border);background:rgba(148,163,184,0.06);';
			const codeBody = DOM.append(codePanel, DOM.$('pre'));
			codeBody.textContent = JSON.stringify({ items: this._buildJsonTree(null), overrides: this.overrides }, null, 2);
			codeBody.style.cssText = 'margin:0;padding:12px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;line-height:1.5;color:var(--vscode-foreground);max-height:560px;overflow:auto;';
		}

		const treeCol = DOM.append(splitWrap, DOM.$('div'));
		treeCol.style.cssText = this.showCode ? 'width:50%;flex:1;display:flex;flex-direction:column;gap:18px;' : 'display:flex;flex-direction:column;gap:18px;';

		// Action buttons row
		const actionsRow = DOM.append(treeCol, DOM.$('div'));
		actionsRow.style.cssText = 'display:flex;align-items:center;gap:10px;';

		const addBtn = DOM.append(actionsRow, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = '+ Add Item';
		addBtn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#2563eb;color:#ffffff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;';
		addBtn.addEventListener('click', () => { this.addParentId = null; this.showAddForm = true; this._render(); });

		if (this.hiddenItems.length > 0) {
			const hiddenBtn = DOM.append(actionsRow, DOM.$('button')) as HTMLButtonElement;
			hiddenBtn.textContent = `Hidden Items (${this.hiddenItems.length})`;
			hiddenBtn.style.cssText = `padding:8px 14px;border:1px solid ${this.showHidden ? '#fcd34d' : 'var(--vscode-input-border,#3c3c3c)'};background:${this.showHidden ? 'rgba(252,211,77,0.15)' : 'transparent'};color:${this.showHidden ? '#f59e0b' : 'var(--vscode-foreground)'};border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;`;
			hiddenBtn.addEventListener('click', () => { this.showHidden = !this.showHidden; this._render(); });
		}

		if (this.hasCustom) {
			const resetBtn = DOM.append(actionsRow, DOM.$('button')) as HTMLButtonElement;
			resetBtn.textContent = '\u21BA Reset All';
			resetBtn.style.cssText = 'padding:8px 14px;border:1px solid var(--vscode-input-border,#3c3c3c);background:transparent;color:var(--vscode-foreground);border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;';
			resetBtn.addEventListener('click', () => void this._handleReset());
		}

		// Info banner
		const info = DOM.append(treeCol, DOM.$('div'));
		info.style.cssText = 'padding:10px 14px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:6px;font-size:12px;color:#3b82f6;';
		info.textContent = 'Changes are saved as overrides on top of the default menu. New items added globally will automatically appear. Use Hide to remove items, Edit to rename, and Revert to undo changes.';

		// Add form
		if (this.showAddForm) {
			treeCol.appendChild(this._renderAddForm());
		}

		// Hidden items panel
		if (this.showHidden && this.hiddenItems.length > 0) {
			treeCol.appendChild(this._renderHiddenPanel());
		}

		// Tree
		const treeWrap = DOM.append(treeCol, DOM.$('div'));
		treeWrap.style.cssText = 'border:1px solid var(--vscode-editorWidget-border);border-radius:8px;padding:14px;background:var(--vscode-editor-background);';
		const treeTitle = DOM.append(treeWrap, DOM.$('h2'));
		treeTitle.textContent = 'SIDEBAR MENU STRUCTURE';
		treeTitle.style.cssText = 'margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:1px;color:var(--vscode-descriptionForeground);';
		const tree = DOM.append(treeWrap, DOM.$('div'));
		tree.style.cssText = 'display:flex;flex-direction:column;gap:2px;';

		const top = this._childrenOf(null);
		if (top.length === 0) {
			const empty = DOM.append(tree, DOM.$('div'));
			empty.textContent = 'No menu items found';
			empty.style.cssText = 'padding:30px;text-align:center;color:var(--vscode-descriptionForeground);';
		}
		for (const item of top) { this._renderItem(tree, item, 0); }
	}

	private _renderAddForm(): HTMLElement {
		const wrap = DOM.$('div');
		wrap.style.cssText = 'border:1px solid rgba(59,130,246,0.4);background:rgba(59,130,246,0.08);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:10px;';
		const ttl = DOM.append(wrap, DOM.$('h3'));
		ttl.textContent = this.addParentId ? 'Add Sub-Item' : 'Add Top-Level Item';
		ttl.style.cssText = 'margin:0;font-size:13px;font-weight:600;';

		const row1 = DOM.append(wrap, DOM.$('div'));
		row1.style.cssText = 'display:grid;grid-template-columns:1fr 120px 1fr 140px;gap:10px;align-items:end;';
		const labelInp = this._formField(row1, 'Label', 'Menu item label', this.newItem.label, v => { this.newItem.label = v; });
		const iconInp = this._formField(row1, 'Icon', 'FileText', this.newItem.icon, v => { this.newItem.icon = v; });
		const routeInp = this._formField(row1, 'Route Path', '/settings/p/my-page', this.newItem.screenSlug, v => { this.newItem.screenSlug = v; });
		const keyInp = this._formField(row1, 'Key', 'auto-generated', this.newItem.itemKey, v => { this.newItem.itemKey = v; });

		const row2 = DOM.append(wrap, DOM.$('div'));
		row2.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:end;';
		this._formField(row2, 'FHIR Resources', 'Practitioner, Organization (comma-separated)', this.newItem.fhirResources, v => { this.newItem.fhirResources = v; });
		const addBtn = DOM.append(row2, DOM.$('button')) as HTMLButtonElement;
		addBtn.textContent = 'Add';
		addBtn.style.cssText = 'padding:8px 16px;background:#2563eb;color:#ffffff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;';
		addBtn.addEventListener('click', () => void this._handleAdd());
		const cancelBtn = DOM.append(row2, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = 'Cancel';
		cancelBtn.style.cssText = 'padding:8px 16px;border:1px solid var(--vscode-input-border,#3c3c3c);background:transparent;color:var(--vscode-foreground);border-radius:6px;cursor:pointer;font-size:13px;';
		cancelBtn.addEventListener('click', () => { this.showAddForm = false; this.addParentId = null; this._render(); });

		setTimeout(() => labelInp.focus(), 30);
		void iconInp; void routeInp; void keyInp;
		return wrap;
	}

	private _formField(parent: HTMLElement, label: string, placeholder: string, value: string, onChange: (v: string) => void): HTMLInputElement {
		const cell = DOM.append(parent, DOM.$('div'));
		const lbl = DOM.append(cell, DOM.$('label'));
		lbl.textContent = label;
		lbl.style.cssText = 'display:block;font-size:11px;font-weight:500;color:var(--vscode-descriptionForeground);margin-bottom:4px;';
		const inp = DOM.append(cell, DOM.$('input')) as HTMLInputElement;
		inp.type = 'text';
		inp.value = value;
		inp.placeholder = placeholder;
		inp.style.cssText = 'width:100%;padding:6px 10px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:6px;color:var(--vscode-input-foreground);font-size:13px;box-sizing:border-box;outline:none;';
		inp.addEventListener('input', () => onChange(inp.value));
		return inp;
	}

	private _renderHiddenPanel(): HTMLElement {
		const wrap = DOM.$('div');
		wrap.style.cssText = 'border:1px solid rgba(252,211,77,0.4);background:rgba(252,211,77,0.08);border-radius:8px;padding:14px;';
		const ttl = DOM.append(wrap, DOM.$('h3'));
		ttl.textContent = '\u{1F6AB} Hidden Items';
		ttl.style.cssText = 'margin:0 0 8px;font-size:13px;font-weight:600;color:#b45309;';
		const list = DOM.append(wrap, DOM.$('div'));
		list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
		for (const it of this.hiddenItems) {
			const row = DOM.append(list, DOM.$('div'));
			row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--vscode-editor-background);border:1px solid rgba(252,211,77,0.25);border-radius:6px;';
			const lbl = DOM.append(row, DOM.$('span'));
			lbl.textContent = it.label;
			lbl.style.cssText = 'flex:1;font-size:13px;color:var(--vscode-foreground);';
			if (it.screenSlug) {
				const slug = DOM.append(row, DOM.$('span'));
				slug.textContent = it.screenSlug;
				slug.style.cssText = 'font-family:monospace;font-size:11px;color:var(--vscode-descriptionForeground);';
			}
			const restoreBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
			restoreBtn.textContent = '\u{1F441} Restore';
			restoreBtn.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:500;background:transparent;color:#b45309;border:1px solid rgba(180,83,9,0.35);border-radius:5px;cursor:pointer;';
			restoreBtn.addEventListener('click', () => void this._handleUnhide(it.id));
		}
		return wrap;
	}

	private _renderItem(parent: HTMLElement, item: MenuItemFlat, depth: number): void {
		const children = this._childrenOf(item.id);
		const hasChildren = children.length > 0;
		const isExpanded = this.expanded.has(item.id);
		const isEditing = this.editingId === item.id;
		const hasMods = item.isModified || item.isReordered;

		const row = DOM.append(parent, DOM.$('div'));
		const rowBg = item.isCustom ? 'rgba(34,197,94,0.08)' : hasMods ? 'rgba(59,130,246,0.06)' : 'var(--vscode-editor-background)';
		const rowBorder = item.isCustom ? 'rgba(34,197,94,0.35)' : hasMods ? 'rgba(59,130,246,0.3)' : 'var(--vscode-editorWidget-border)';
		row.style.cssText = `display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid ${rowBorder};background:${rowBg};border-radius:7px;margin-left:${depth * 24}px;`;

		// Expand toggle
		const expandBtn = DOM.append(row, DOM.$('button')) as HTMLButtonElement;
		expandBtn.style.cssText = `width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;background:none;border:none;cursor:${hasChildren ? 'pointer' : 'default'};color:var(--vscode-descriptionForeground);font-size:11px;visibility:${hasChildren ? 'visible' : 'hidden'};`;
		expandBtn.textContent = isExpanded ? '\u25BE' : '\u25B8';
		if (hasChildren) { expandBtn.addEventListener('click', () => { this._toggleExpand(item.id); }); }

		if (isEditing) {
			this._renderEditRow(row, item);
		} else {
			const drag = DOM.append(row, DOM.$('span'));
			drag.textContent = '\u22EE\u22EE';
			drag.style.cssText = 'color:#cbd5e1;font-size:13px;letter-spacing:-2px;';

			const label = DOM.append(row, DOM.$('span'));
			label.textContent = item.label;
			label.style.cssText = 'flex:1;font-size:13px;font-weight:500;color:var(--vscode-foreground);';

			if (item.screenSlug) {
				const slug = DOM.append(row, DOM.$('span'));
				slug.textContent = item.screenSlug;
				slug.style.cssText = 'font-family:monospace;font-size:11px;color:var(--vscode-descriptionForeground);';
			}

			if (item.isCustom) {
				this._badge(row, 'Custom', '#22c55e', 'rgba(34,197,94,0.15)');
			}
			if (item.isModified) {
				this._badge(row, 'Modified', '#3b82f6', 'rgba(59,130,246,0.15)');
			}

			const actions = DOM.append(row, DOM.$('div'));
			actions.style.cssText = 'display:flex;align-items:center;gap:2px;';
			this._iconBtn(actions, '\u25B4', 'Move up', () => void this._handleMove(item.id, 'up'));
			this._iconBtn(actions, '\u25BE', 'Move down', () => void this._handleMove(item.id, 'down'));
			this._iconBtn(actions, '\u270E', 'Edit', () => this._startEdit(item));
			this._iconBtn(actions, '+', 'Add child', () => { this.addParentId = item.id; this.showAddForm = true; if (!isExpanded) { this.expanded.add(item.id); } this._render(); });
			if (hasMods) {
				this._iconBtn(actions, '\u21B6', 'Revert changes', () => void this._handleRevert(item.id), '#f97316');
			}
			if (item.isCustom) {
				this._iconBtn(actions, '\u{1F5D1}', 'Delete custom item', () => void this._handleDeleteCustom(item.id), '#ef4444');
			} else {
				this._iconBtn(actions, '\u2298', 'Hide from sidebar', () => void this._handleHide(item.id), '#ef4444');
			}
		}

		if (hasChildren && isExpanded) {
			for (const c of children) { this._renderItem(parent, c, depth + 1); }
		}
	}

	private _renderEditRow(row: HTMLElement, item: MenuItemFlat): void {
		const stack = DOM.append(row, DOM.$('div'));
		stack.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:6px;';

		const top = DOM.append(stack, DOM.$('div'));
		top.style.cssText = 'display:flex;align-items:center;gap:6px;';
		const iconInp = DOM.append(top, DOM.$('input')) as HTMLInputElement;
		iconInp.type = 'text';
		iconInp.value = this.editForm.icon;
		iconInp.placeholder = 'FileText';
		iconInp.style.cssText = 'width:110px;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:12px;';
		iconInp.addEventListener('input', () => { this.editForm.icon = iconInp.value; });

		const labelInp = DOM.append(top, DOM.$('input')) as HTMLInputElement;
		labelInp.type = 'text';
		labelInp.value = this.editForm.label;
		labelInp.placeholder = 'Label';
		labelInp.style.cssText = 'flex:1;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:12px;';
		labelInp.addEventListener('input', () => { this.editForm.label = labelInp.value; });

		const routeInp = DOM.append(top, DOM.$('input')) as HTMLInputElement;
		routeInp.type = 'text';
		routeInp.value = this.editForm.screenSlug;
		routeInp.placeholder = 'Route path';
		routeInp.style.cssText = 'width:200px;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:12px;';
		routeInp.addEventListener('input', () => { this.editForm.screenSlug = routeInp.value; });

		const okBtn = DOM.append(top, DOM.$('button')) as HTMLButtonElement;
		okBtn.textContent = '✓';
		okBtn.title = 'Save';
		okBtn.style.cssText = 'padding:3px 8px;background:transparent;border:none;color:#16a34a;cursor:pointer;font-size:13px;font-weight:700;';
		okBtn.addEventListener('click', () => void this._saveEdit(item.id));

		const cancelBtn = DOM.append(top, DOM.$('button')) as HTMLButtonElement;
		cancelBtn.textContent = '\u2715';
		cancelBtn.title = 'Cancel';
		cancelBtn.style.cssText = 'padding:3px 8px;background:transparent;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:13px;font-weight:700;';
		cancelBtn.addEventListener('click', () => { this.editingId = null; this._render(); });

		const fhirRow = DOM.append(stack, DOM.$('div'));
		fhirRow.style.cssText = 'padding-left:30px;';
		const fhirInp = DOM.append(fhirRow, DOM.$('input')) as HTMLInputElement;
		fhirInp.type = 'text';
		fhirInp.value = this.editForm.fhirResources;
		fhirInp.placeholder = 'FHIR Resources (comma-separated, e.g. Practitioner, Organization)';
		fhirInp.style.cssText = 'width:100%;padding:4px 8px;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#3c3c3c);border-radius:5px;color:var(--vscode-input-foreground);font-size:11px;box-sizing:border-box;';
		fhirInp.addEventListener('input', () => { this.editForm.fhirResources = fhirInp.value; });

		setTimeout(() => labelInp.focus(), 30);
	}

	private _badge(parent: HTMLElement, text: string, color: string, bg: string): void {
		const b = DOM.append(parent, DOM.$('span'));
		b.textContent = text;
		b.style.cssText = `padding:1px 8px;font-size:10px;font-weight:600;border-radius:4px;background:${bg};color:${color};`;
	}

	private _iconBtn(parent: HTMLElement, glyph: string, title: string, onClick: () => void, color?: string): void {
		const b = DOM.append(parent, DOM.$('button')) as HTMLButtonElement;
		b.textContent = glyph;
		b.title = title;
		b.style.cssText = `padding:3px 6px;background:transparent;border:none;cursor:pointer;font-size:13px;color:${color || 'var(--vscode-descriptionForeground)'};border-radius:4px;`;
		b.addEventListener('mouseenter', () => { b.style.background = 'rgba(148,163,184,0.15)'; });
		b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
		b.addEventListener('click', onClick);
	}

	private _childrenOf(parentId: string | null): MenuItemFlat[] {
		return this.items.filter(i => i.parentId === parentId).sort((a, b) => a.position - b.position);
	}

	private _toggleExpand(id: string): void {
		if (this.expanded.has(id)) { this.expanded.delete(id); }
		else { this.expanded.add(id); }
		this._render();
	}

	private _buildJsonTree(parentId: string | null): unknown[] {
		const children = this._childrenOf(parentId);
		return children.map(c => ({
			itemKey: c.itemKey,
			label: c.label,
			icon: c.icon,
			screenSlug: c.screenSlug,
			position: c.position,
			isCustom: c.isCustom,
			isModified: c.isModified,
			children: this._buildJsonTree(c.id),
		}));
	}

	private async _startEdit(item: MenuItemFlat): Promise<void> {
		this.editingId = item.id;
		this.editForm = { label: item.label, icon: item.icon || '', screenSlug: item.screenSlug || '', fhirResources: '' };
		this._render();
		// Best-effort FHIR resources fetch — same heuristic as the web UI.
		const slug = item.screenSlug || '';
		const tabKey = slug.match(/\/settings\/p\/(.+)/)?.[1] || slug.match(/\/settings\/layout-settings\/config\/(.+)/)?.[1];
		if (tabKey) {
			try {
				const res = await this.apiService.fetch(`/api/tab-field-config/${tabKey}`);
				if (res.ok) {
					const data = await res.json();
					const fhir = Array.isArray(data?.fhirResources)
						? data.fhirResources.map((r: unknown) => typeof r === 'string' ? r : ((r as { type?: string })?.type || '')).filter(Boolean).join(', ')
						: '';
					this.editForm.fhirResources = fhir;
					if (this.editingId === item.id) { this._render(); }
				}
			} catch { /* ignore */ }
		}
	}

	private async _saveEdit(id: string): Promise<void> {
		const changes: Record<string, string> = {};
		if (this.editForm.label) { changes.label = this.editForm.label; }
		if (this.editForm.icon) { changes.icon = this.editForm.icon; }
		if (this.editForm.screenSlug) { changes.screenSlug = this.editForm.screenSlug; }

		const res = await this.apiService.fetch(`/api/menus/ehr-sidebar/items/${id}/modify`, {
			method: 'PUT', body: JSON.stringify(changes),
		});
		if (!res.ok) {
			this.notificationService.notify({ severity: Severity.Error, message: `Modify failed (${res.status}).` });
			return;
		}

		if (this.editForm.fhirResources) {
			const slug = this.editForm.screenSlug || '';
			const tabKey = slug.match(/\/settings\/p\/(.+)/)?.[1] || slug.match(/\/settings\/layout-settings\/config\/(.+)/)?.[1];
			if (tabKey) {
				const fhirArray = this.editForm.fhirResources.split(',').map(s => s.trim()).filter(Boolean).map(type => ({ type }));
				await this.apiService.fetch(`/api/tab-field-config/${tabKey}`, {
					method: 'PUT', body: JSON.stringify({ fhirResources: fhirArray, fieldConfig: { sections: [] } }),
				});
			}
		}

		this.editingId = null;
		await this._loadMenu();
		this._render();
	}

	private async _handleHide(itemId: string): Promise<void> {
		const item = this.items.find(i => i.id === itemId);
		const { confirmed } = await this.dialogService.confirm({ message: `Hide "${item?.label}" from sidebar? You can restore it later.` });
		if (!confirmed) { return; }
		const res = await this.apiService.fetch(`/api/menus/ehr-sidebar/items/${itemId}/hide`, { method: 'POST' });
		if (res.ok) { await this._loadMenu(); this._render(); }
		else { this.notificationService.notify({ severity: Severity.Error, message: `Hide failed (${res.status}).` }); }
	}

	private async _handleUnhide(itemId: string): Promise<void> {
		const res = await this.apiService.fetch(`/api/menus/ehr-sidebar/items/${itemId}/hide`, { method: 'DELETE' });
		if (res.ok) { await this._loadMenu(); this._render(); }
		else { this.notificationService.notify({ severity: Severity.Error, message: `Restore failed (${res.status}).` }); }
	}

	private async _handleMove(itemId: string, direction: 'up' | 'down'): Promise<void> {
		const item = this.items.find(i => i.id === itemId);
		if (!item) { return; }
		const siblings = this._childrenOf(item.parentId);
		const idx = siblings.findIndex(s => s.id === itemId);
		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= siblings.length) { return; }
		const ordering = siblings.map((s, i) => {
			if (i === idx) { return { id: siblings[swapIdx].id, position: i }; }
			if (i === swapIdx) { return { id: siblings[idx].id, position: i }; }
			return { id: s.id, position: i };
		});
		const res = await this.apiService.fetch('/api/menus/ehr-sidebar/reorder', { method: 'PUT', body: JSON.stringify(ordering) });
		if (res.ok) { await this._loadMenu(); this._render(); }
		else { this.notificationService.notify({ severity: Severity.Error, message: `Reorder failed (${res.status}).` }); }
	}

	private async _handleRevert(itemId: string): Promise<void> {
		const item = this.items.find(i => i.id === itemId);
		const { confirmed } = await this.dialogService.confirm({ message: `Revert changes to "${item?.label}"?` });
		if (!confirmed) { return; }
		const toDelete = this.overrides.filter(o => o.itemId === itemId && (o.action === 'modify' || o.action === 'reorder'));
		for (const ov of toDelete) {
			await this.apiService.fetch(`/api/menus/overrides/${ov.id}`, { method: 'DELETE' });
		}
		await this._loadMenu();
		this._render();
	}

	private async _handleDeleteCustom(itemId: string): Promise<void> {
		const item = this.items.find(i => i.id === itemId);
		const { confirmed } = await this.dialogService.confirm({ message: `Delete custom item "${item?.label}"?` });
		if (!confirmed) { return; }
		const ov = this.overrides.find(o => o.action === 'add' && o.id === itemId);
		if (ov) {
			await this.apiService.fetch(`/api/menus/overrides/${ov.id}`, { method: 'DELETE' });
		}
		await this._loadMenu();
		this._render();
	}

	private async _handleAdd(): Promise<void> {
		if (!this.newItem.label.trim()) {
			this.notificationService.notify({ severity: Severity.Warning, message: 'Label is required.' });
			return;
		}
		const key = this.newItem.itemKey.trim() || this.newItem.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
		const siblings = this._childrenOf(this.addParentId);
		const res = await this.apiService.fetch('/api/menus/ehr-sidebar/custom-items', {
			method: 'POST',
			body: JSON.stringify({
				itemKey: key,
				label: this.newItem.label,
				icon: this.newItem.icon || null,
				screenSlug: this.newItem.screenSlug || null,
				parentId: this.addParentId,
				position: siblings.length,
			}),
		});
		if (!res.ok) {
			this.notificationService.notify({ severity: Severity.Error, message: `Add failed (${res.status}).` });
			return;
		}
		if (this.newItem.fhirResources) {
			const fhirArray = this.newItem.fhirResources.split(',').map(s => s.trim()).filter(Boolean).map(type => ({ type }));
			await this.apiService.fetch(`/api/tab-field-config/${key}`, {
				method: 'PUT',
				body: JSON.stringify({ fhirResources: fhirArray, fieldConfig: { sections: [] }, category: 'Settings' }),
			});
		}
		this.showAddForm = false;
		this.newItem = { label: '', icon: 'FileText', screenSlug: '', itemKey: '', fhirResources: '' };
		this.addParentId = null;
		await this._loadMenu();
		this._render();
	}

	private async _handleReset(): Promise<void> {
		const { confirmed } = await this.dialogService.confirm({
			message: 'Reset sidebar menu to defaults? All your customizations (hidden items, label changes, reordering, custom items) will be removed.',
		});
		if (!confirmed) { return; }
		const res = await this.apiService.fetch('/api/menus/ehr-sidebar/reset', { method: 'POST' });
		if (res.ok) {
			await this._loadMenu();
			this._render();
			this.notificationService.notify({ severity: Severity.Info, message: 'Menu reset to defaults.' });
		} else {
			this.notificationService.notify({ severity: Severity.Error, message: `Reset failed (${res.status}).` });
		}
	}

	override layout(dim: DOM.Dimension): void {
		this.root.style.height = `${dim.height}px`;
		this.root.style.width = `${dim.width}px`;
	}
}
