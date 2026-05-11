/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';

/**
 * Shared client-side pagination control for Ciyex EHR list/table editors.
 *
 * Usage:
 *   const pager = new PaginationControl({ pageSize: 25, onChange: () => renderRows() });
 *   container.appendChild(pager.element);
 *   pager.setTotal(items.length);
 *   const visible = pager.slice(items);
 */

export interface IPaginationOptions {
	/** Initial page size. Defaults to 25. */
	pageSize?: number;
	/** Available page size choices. Defaults to [10, 25, 50, 100]. */
	pageSizeOptions?: number[];
	/** Fired whenever the page or page size changes. */
	onChange?: () => void;
	/** Optional label for the unit being paginated (e.g. "appointments"). */
	itemLabel?: string;
}

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export class PaginationControl extends Disposable {

	readonly element: HTMLElement;

	private _total = 0;
	private _page = 1;
	private _pageSize: number;
	private readonly _pageSizeOptions: number[];
	private readonly _onChange?: () => void;
	private readonly _itemLabel: string;

	constructor(options: IPaginationOptions = {}) {
		super();
		this._pageSize = options.pageSize ?? 25;
		this._pageSizeOptions = options.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS;
		this._onChange = options.onChange;
		this._itemLabel = options.itemLabel ?? 'items';
		this.element = DOM.$('div.ciyex-pagination');
		this.element.style.display = 'none';
		this.render();
	}

	get page(): number { return this._page; }
	get pageSize(): number { return this._pageSize; }
	get total(): number { return this._total; }
	get totalPages(): number { return Math.max(1, Math.ceil(this._total / this._pageSize)); }

	setTotal(total: number): void {
		this._total = Math.max(0, total);
		if (this._page > this.totalPages) {
			this._page = this.totalPages;
		}
		this.render();
	}

	setPage(page: number): void {
		const next = Math.min(this.totalPages, Math.max(1, page));
		if (next !== this._page) {
			this._page = next;
			this.render();
			this._onChange?.();
		}
	}

	setPageSize(size: number): void {
		if (size > 0 && size !== this._pageSize) {
			this._pageSize = size;
			this._page = 1;
			this.render();
			this._onChange?.();
		}
	}

	/** Returns the slice of `items` for the current page. */
	slice<T>(items: readonly T[]): T[] {
		const start = (this._page - 1) * this._pageSize;
		return items.slice(start, start + this._pageSize);
	}

	private render(): void {
		DOM.clearNode(this.element);
		if (this._total === 0) {
			this.element.style.display = 'none';
			return;
		}
		this.element.style.display = 'flex';

		const start = (this._page - 1) * this._pageSize + 1;
		const end = Math.min(this._total, this._page * this._pageSize);
		const info = DOM.append(this.element, DOM.$('div.ciyex-pagination-info'));
		info.textContent = `Showing ${start}-${end} of ${this._total} ${this._itemLabel}`;

		const sizeWrap = DOM.append(this.element, DOM.$('div.ciyex-pagination-size'));
		const sizeLabel = DOM.append(sizeWrap, DOM.$('span'));
		sizeLabel.textContent = 'Rows:';
		const select = DOM.append(sizeWrap, DOM.$('select')) as HTMLSelectElement;
		for (const opt of this._pageSizeOptions) {
			const o = document.createElement('option');
			o.value = String(opt);
			o.textContent = String(opt);
			if (opt === this._pageSize) { o.selected = true; }
			select.appendChild(o);
		}
		this._register(DOM.addDisposableListener(select, 'change', () => {
			const v = parseInt(select.value, 10);
			if (!isNaN(v)) { this.setPageSize(v); }
		}));

		const pages = DOM.append(this.element, DOM.$('div.ciyex-pagination-pages'));

		const mkBtn = (label: string, target: number, opts: { disabled?: boolean; active?: boolean } = {}): HTMLButtonElement => {
			const b = DOM.append(pages, DOM.$('button.ciyex-pagination-btn')) as HTMLButtonElement;
			b.textContent = label;
			b.type = 'button';
			if (opts.disabled) { b.disabled = true; }
			if (opts.active) { b.classList.add('is-active'); }
			this._register(DOM.addDisposableListener(b, 'click', () => this.setPage(target)));
			return b;
		};

		const totalPages = this.totalPages;
		mkBtn('Prev', this._page - 1, { disabled: this._page === 1 });

		const pageNumbers = computePageNumbers(this._page, totalPages);
		for (const item of pageNumbers) {
			if (item === '...') {
				const span = DOM.append(pages, DOM.$('span.ciyex-pagination-ellipsis'));
				span.textContent = '...';
			} else {
				mkBtn(String(item), item, { active: item === this._page });
			}
		}

		mkBtn('Next', this._page + 1, { disabled: this._page === totalPages });
	}
}

/**
 * Compute the page-number sequence to display (with ellipses) given the
 * current page and the total pages, e.g.
 *   (5, 20) --> [1, '...', 4, 5, 6, '...', 20]
 *   (1,  3) --> [1, 2, 3]
 *   (1,  1) --> [1]
 */
export function computePageNumbers(page: number, totalPages: number): (number | '...')[] {
	if (totalPages <= 7) {
		const arr: number[] = [];
		for (let i = 1; i <= totalPages; i++) { arr.push(i); }
		return arr;
	}
	const out: (number | '...')[] = [1];
	const left = Math.max(2, page - 1);
	const right = Math.min(totalPages - 1, page + 1);
	if (left > 2) { out.push('...'); }
	for (let i = left; i <= right; i++) { out.push(i); }
	if (right < totalPages - 1) { out.push('...'); }
	out.push(totalPages);
	return out;
}
