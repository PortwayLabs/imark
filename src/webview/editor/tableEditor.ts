// In-place table editing for the live preview: cells are contenteditable, the
// active cell shows its Markdown source, and every change is written back to
// the document as a re-serialized table. The widget DOM is kept alive across
// document updates (see TableWidget.updateDOM) so focus is never lost.
//
// Besides typing in cells the controller supports rectangular cell ranges
// (drag, Shift+click, row/column handles, Mod+A twice) that can be copied, cut,
// pasted over and cleared, plus row/column handles with a context menu.
//
// Keyboard events are only stopped when the table handles them itself: in VS Code
// the webview forwards unhandled keys (copy / paste / cut / save ...) to the
// workbench from a `window` listener, so blanket `stopPropagation()` breaks them.
import type { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { renderInline, type RenderContext } from '../render/markdownIt';
import { svgIconElement } from '../render/icons';
import {
  cellText,
  cellToPlain,
  clearRange,
  deleteColumns,
  deleteRows,
  duplicateRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  normalizeRange,
  parseClipboardGrid,
  pasteGrid,
  rangeCells,
  rangeToMarkdown,
  rangeToTsv,
  sanitizeCell,
  serializeTable,
  setAlign,
  type Align,
  type CellRange,
  type TableModel,
} from './tableModel';

export interface TableControllerOptions {
  view: EditorView;
  /** The widget root (`.cm-table-widget`), used to locate the table in the document. */
  host: HTMLElement;
  model: TableModel;
  source: string;
  rctx: RenderContext;
  /** Put the CodeMirror cursor inside the table source (raw editing). */
  editSource(): void;
}

interface CellRef {
  r: number; // -1 = header
  c: number;
}

/** Clipboard type used to paste exact cell grids between iMark tables. */
const CELLS_MIME = 'application/x-imark-table-cells';

type MenuEntry = { icon: string; label: string; action: () => void; disabled?: boolean; shortcut?: string } | 'sep';

export class TableController {
  readonly root: HTMLElement;
  readonly wrapper: HTMLElement;
  readonly table: HTMLTableElement;
  model: TableModel;
  source: string;
  private active: CellRef | null = null;
  /** Range anchor / head; a range exists when both are set. */
  private anchor: CellRef | null = null;
  private head: CellRef | null = null;
  private dragFrom: CellRef | null = null;
  private hover: CellRef | null = null;
  private readonly clip: HTMLTextAreaElement;
  private readonly rowHandle: HTMLElement;
  private readonly colHandle: HTMLElement;
  private menu: HTMLElement | null = null;
  private disposed = false;
  private readonly onDocMouseDown = (e: MouseEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
  };
  private readonly onDocMouseUp = () => this.endDrag();

  constructor(private readonly opts: TableControllerOptions) {
    this.model = opts.model;
    this.source = opts.source;
    this.root = document.createElement('div');
    this.root.className = 'table-editor';
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'table-wrapper';
    this.table = document.createElement('table');
    // Focus target while a cell range is selected: an (invisible) editable element so that
    // keys and copy / cut / paste events are delivered in every host, like spreadsheets do.
    this.clip = document.createElement('textarea');
    this.clip.className = 'imark-table-clipboard';
    this.clip.setAttribute('aria-hidden', 'true');
    this.clip.tabIndex = -1;
    this.clip.spellcheck = false;
    this.wrapper.append(this.table, this.clip);
    this.root.appendChild(this.wrapper);

    const colBtn = this.button('table-col-btn', 'plus', 'Add column', () => {
      this.apply(insertColumn(this.model, this.model.header.length));
      this.focusCell({ r: -1, c: this.model.header.length - 1 });
    });
    const rowBtn = this.button('table-row-btn', 'plus', 'Add row', () => {
      this.apply(insertRow(this.model, this.model.rows.length));
      this.focusCell({ r: this.model.rows.length - 1, c: 0 });
    });
    this.rowHandle = this.button('imark-table-handle mod-row', 'grip-vertical', 'Row actions', (e) => this.onHandleClick('row', e));
    this.colHandle = this.button('imark-table-handle mod-col', 'grip-horizontal', 'Column actions', (e) => this.onHandleClick('col', e));
    this.root.append(colBtn, rowBtn, this.rowHandle, this.colHandle);

    this.build();
    this.wrapper.addEventListener('focusin', (e) => this.onFocusIn(e));
    this.wrapper.addEventListener('focusout', (e) => this.onFocusOut(e));
    this.wrapper.addEventListener('input', (e) => this.onInput(e));
    this.wrapper.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.wrapper.addEventListener('paste', (e) => this.onPaste(e));
    this.wrapper.addEventListener('copy', (e) => this.onCopy(e, false));
    this.wrapper.addEventListener('cut', (e) => this.onCopy(e, true));
    this.wrapper.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.wrapper.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.wrapper.addEventListener('mouseover', (e) => this.onMouseOver(e));
    this.wrapper.addEventListener('scroll', () => this.placeHandles(), { passive: true });
    this.root.addEventListener('mouseleave', () => {
      this.hover = null;
      this.placeHandles();
    });
  }

  // ---- DOM construction ----------------------------------------------------------

  private button(cls: string, icon: string, label: string, onClick: (e: MouseEvent) => void): HTMLElement {
    const btn = document.createElement('div');
    btn.className = cls;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('role', 'button');
    btn.appendChild(svgIconElement(icon));
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(e);
    });
    return btn;
  }

  private cellAt(ref: CellRef): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(`.table-cell-wrapper[data-r="${ref.r}"][data-c="${ref.c}"]`);
  }

  private refOf(el: Element | null): CellRef | null {
    const cell = el instanceof Element ? el.closest('th, td') : null;
    const div = cell?.querySelector<HTMLElement>(':scope > .table-cell-wrapper');
    if (!div || !this.table.contains(div)) return null;
    return { r: parseInt(div.dataset.r ?? '0', 10), c: parseInt(div.dataset.c ?? '0', 10) };
  }

  private textOf(ref: CellRef): string {
    return cellText(this.model, ref.r, ref.c);
  }

  private setText(ref: CellRef, text: string) {
    if (ref.r < 0) {
      const header = this.model.header.slice();
      header[ref.c] = text;
      this.model = { ...this.model, header };
    } else {
      const rows = this.model.rows.map((row) => row.slice());
      rows[ref.r][ref.c] = text;
      this.model = { ...this.model, rows };
    }
  }

  private makeCell(tag: 'th' | 'td', ref: CellRef): HTMLElement {
    const cell = document.createElement(tag);
    const align = this.model.aligns[ref.c];
    if (align) cell.style.textAlign = align;
    const div = document.createElement('div');
    div.className = 'table-cell-wrapper';
    div.setAttribute('contenteditable', 'true');
    div.setAttribute('spellcheck', 'false');
    div.dataset.r = String(ref.r);
    div.dataset.c = String(ref.c);
    this.render(div, this.textOf(ref));
    cell.appendChild(div);
    return cell;
  }

  private render(div: HTMLElement, text: string) {
    div.dataset.src = text;
    div.dataset.raw = '';
    div.innerHTML = renderInline(text, this.opts.rctx);
  }

  private build() {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    this.model.header.forEach((_, c) => tr.appendChild(this.makeCell('th', { r: -1, c })));
    thead.appendChild(tr);
    const tbody = document.createElement('tbody');
    this.model.rows.forEach((row, r) => {
      const trb = document.createElement('tr');
      row.forEach((_, c) => trb.appendChild(this.makeCell('td', { r, c })));
      tbody.appendChild(trb);
    });
    this.table.replaceChildren(thead, tbody);
    this.paintRange();
    this.placeHandles();
  }

  /** True while CodeMirror is updating the view (dispatching is not allowed then). */
  private inUpdate = false;

  /** Reconcile the DOM with a new model (called from TableWidget.updateDOM). */
  update(model: TableModel, source: string) {
    this.inUpdate = true;
    try {
      this.reconcile(model, source);
    } finally {
      this.inUpdate = false;
    }
  }

  private reconcile(model: TableModel, source: string) {
    // Compare against what is actually rendered: `this.model` may already hold the
    // new structure when the change originated from this controller (apply()).
    const domCols = this.table.querySelectorAll('thead th').length;
    const domRows = this.table.querySelectorAll('tbody tr').length;
    const structureChanged = model.header.length !== domCols || model.rows.length !== domRows;
    this.model = model;
    this.source = source;
    if (structureChanged) {
      const active = this.active;
      const hadFocus = this.table.contains(document.activeElement);
      this.clampRange();
      this.build();
      this.active = null;
      if (active && hadFocus) {
        const ref = { r: Math.min(active.r, model.rows.length - 1), c: Math.min(active.c, model.header.length - 1) };
        if (ref.r >= -1 && ref.c >= 0) this.focusCell(ref, 'end');
      }
      return;
    }
    this.table.querySelectorAll<HTMLElement>('.table-cell-wrapper').forEach((div) => {
      const ref = this.refOf(div)!;
      const text = this.textOf(ref);
      const cell = div.parentElement as HTMLElement;
      const align = model.aligns[ref.c];
      cell.style.textAlign = align ?? '';
      if (this.active && ref.r === this.active.r && ref.c === this.active.c && div.dataset.raw === '1') {
        // The cell being edited: only touch it when the model diverged (undo/redo, external edit).
        if (sanitizeCell(div.textContent ?? '') !== text) {
          div.textContent = text;
          placeCaretAtEnd(div);
        }
      } else if (div.dataset.src !== text) {
        this.render(div, text);
      }
    });
    this.placeHandles();
  }

  // ---- editing ---------------------------------------------------------------------------

  private onFocusIn(e: FocusEvent) {
    this.opts.host.classList.add('is-editing');
    this.parkSelection();
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    // Focusing a cell (click, Tab, programmatic) ends a cell range.
    this.clearRange();
    const div = this.cellAt(ref);
    if (!div || div.dataset.raw === '1') return;
    this.active = ref;
    div.dataset.raw = '1';
    div.textContent = this.textOf(ref);
    div.parentElement?.classList.add('is-editing');
    this.placeHandles();
  }

  /** Park the editor selection right after the table so that history (undo/redo)
   *  and scrollIntoView keep the viewport at the table instead of jumping away. */
  private parkSelection() {
    if (this.inUpdate) {
      queueMicrotask(() => this.parkSelection());
      return;
    }
    if (this.disposed || !this.opts.host.isConnected) return;
    const from = this.opts.view.posAtDOM(this.opts.host);
    if (from < 0) return;
    const to = Math.min(from + this.source.length, this.opts.view.state.doc.length);
    if (this.opts.view.state.selection.main.head !== to) this.opts.view.dispatch({ selection: { anchor: to } });
  }

  private onFocusOut(e: FocusEvent) {
    // Chrome fires focusout while a focused cell is being removed by a rebuild; the
    // model then already holds the new document text and must not be overwritten.
    if (this.inUpdate) return;
    const next = e.relatedTarget as Node | null;
    const div = (e.target as HTMLElement).closest<HTMLElement>('.table-cell-wrapper');
    if (div && this.table.contains(div)) {
      const ref = this.refOf(div);
      if (ref) {
        this.commitCell(div, ref);
        div.parentElement?.classList.remove('is-editing');
        this.render(div, this.textOf(ref));
        if (this.active && this.active.r === ref.r && this.active.c === ref.c) this.active = null;
      }
    }
    if (!next || !this.wrapper.contains(next)) {
      if (!this.menu) this.clearRange();
    }
    // Delay so that focus moving to another cell keeps the host marked as editing.
    setTimeout(() => {
      if (!this.wrapper.contains(document.activeElement)) this.opts.host.classList.remove('is-editing');
    }, 0);
  }

  private onInput(e: Event) {
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    const div = this.cellAt(ref);
    if (div) this.commitCell(div, ref);
  }

  private commitCell(div: HTMLElement, ref: CellRef) {
    if (div.dataset.raw !== '1') return;
    const text = sanitizeCell(div.innerText.replace(/ /g, ' '));
    if (text === this.textOf(ref)) return;
    this.setText(ref, text);
    this.commit();
  }

  /** Write the current model back into the document. */
  private commit() {
    const next = serializeTable(this.model);
    if (next === this.source) return;
    const from = this.opts.view.posAtDOM(this.opts.host);
    if (from < 0) return;
    const to = from + this.source.length;
    this.source = next;
    this.opts.view.dispatch({ changes: { from, to, insert: next }, userEvent: 'input.table' });
  }

  private apply(model: TableModel) {
    // Cell text is committed on every input event, so `this.model` is current here.
    this.model = model;
    this.commit();
    // The dispatch above rebuilt the DOM synchronously via updateDOM when the structure changed.
  }

  focusCell(ref: CellRef, caret: 'start' | 'end' | 'all' = 'all') {
    this.clearRange();
    const div = this.cellAt(ref);
    if (!div) return;
    div.focus();
    if (caret === 'all') selectAll(div);
    else if (caret === 'end') placeCaretAtEnd(div);
    else placeCaretAtStart(div);
  }

  /** Leave the table and put the CodeMirror cursor before or after it. */
  private exit(where: 'before' | 'after') {
    (document.activeElement as HTMLElement | null)?.blur();
    this.clearRange();
    const view = this.opts.view;
    const from = view.posAtDOM(this.opts.host);
    if (from < 0) return;
    const anchor = where === 'after' ? Math.min(from + this.source.length + 1, view.state.doc.length) : Math.max(0, from - 1);
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
  }

  private nextRef(ref: CellRef, dr: number, dc: number): CellRef | null {
    const cols = this.model.header.length;
    let { r, c } = ref;
    c += dc;
    if (c >= cols) {
      c = 0;
      r += 1;
    } else if (c < 0) {
      c = cols - 1;
      r -= 1;
    }
    r += dr;
    if (r < -1 || r >= this.model.rows.length) return null;
    return { r, c };
  }

  // ---- ranges ------------------------------------------------------------------------------

  get range(): CellRange | null {
    if (!this.anchor || !this.head) return null;
    return normalizeRange({ r0: this.anchor.r, c0: this.anchor.c, r1: this.head.r, c1: this.head.c });
  }

  /** Select a rectangular range; keyboard focus moves to the hidden clipboard textarea. */
  selectRange(anchor: CellRef, head: CellRef) {
    const active = document.activeElement as HTMLElement | null;
    if (active && this.table.contains(active)) active.blur();
    this.anchor = anchor;
    this.head = head;
    this.paintRange();
    // The textarea holds the range as Markdown, selected: the native copy is correct even
    // if a host bypasses the copy event handler.
    this.clip.value = this.clipboardPayload(this.range!).plain || ' ';
    if (document.activeElement !== this.clip) this.clip.focus({ preventScroll: true });
    this.clip.select();
    this.opts.host.classList.add('is-editing');
    this.parkSelection();
  }

  private clearRange() {
    if (!this.anchor && !this.head) return;
    this.anchor = this.head = null;
    this.paintRange();
  }

  private clampRange() {
    if (!this.anchor || !this.head) return;
    const clamp = (ref: CellRef): CellRef => ({ r: Math.min(ref.r, this.model.rows.length - 1), c: Math.min(ref.c, this.model.header.length - 1) });
    this.anchor = clamp(this.anchor);
    this.head = clamp(this.head);
  }

  private paintRange() {
    const range = this.range;
    this.root.classList.toggle('has-range', !!range);
    this.table.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
    if (!range) return;
    for (let r = range.r0; r <= range.r1; r++) {
      for (let c = range.c0; c <= range.c1; c++) this.cellAt({ r, c })?.parentElement?.classList.add('is-selected');
    }
  }

  private wholeRows(range: CellRange): boolean {
    return range.c0 === 0 && range.c1 === this.model.header.length - 1;
  }

  private wholeColumns(range: CellRange): boolean {
    return range.r0 === -1 && range.r1 === this.model.rows.length - 1;
  }

  private selectRows(r0: number, r1: number) {
    this.selectRange({ r: r0, c: 0 }, { r: r1, c: this.model.header.length - 1 });
  }

  private selectColumns(c0: number, c1: number) {
    this.selectRange({ r: -1, c: c0 }, { r: this.model.rows.length - 1, c: c1 });
  }

  // ---- keyboard ----------------------------------------------------------------------------

  private onKeyDown(e: KeyboardEvent) {
    if (e.isComposing) return;
    const range = this.range;
    if (range && e.target === this.clip) return this.onRangeKey(e, range);
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    const div = this.cellAt(ref)!;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    const rows = this.model.rows.length;
    const cols = this.model.header.length;

    // Structure: delete row / column, move row.
    if (mod && e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete')) {
      handled();
      if (e.altKey) this.deleteColumnsAt(ref.c, ref.c, ref);
      else this.deleteRowsAt(ref.r, ref.r, ref);
      return;
    }
    if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      if (ref.r < 0) return;
      handled();
      const to = ref.r + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= rows) return;
      this.apply(moveRow(this.model, ref.r, to));
      this.focusCell({ r: to, c: ref.c }, 'end');
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && key === 'a') {
      // First press selects the cell text (native); a second press selects every cell.
      const len = (div.textContent ?? '').length;
      const sel = window.getSelection();
      if (len === 0 || (sel && sel.toString().length >= len)) {
        handled();
        this.selectRange({ r: -1, c: 0 }, { r: rows - 1, c: cols - 1 });
      }
      return;
    }
    if (e.key === 'Tab') {
      handled();
      const next = this.nextRef(ref, 0, e.shiftKey ? -1 : 1);
      if (next) return this.focusCell(next);
      if (!e.shiftKey) {
        this.apply(insertRow(this.model, rows));
        this.focusCell({ r: this.model.rows.length - 1, c: 0 });
      }
      return;
    }
    if (e.key === 'Enter') {
      handled();
      if (e.shiftKey && !mod) return insertText('<br>');
      if (mod && e.shiftKey) {
        const at = Math.max(0, ref.r);
        this.apply(insertRow(this.model, at));
        return this.focusCell({ r: at, c: ref.c });
      }
      if (e.altKey || mod) {
        this.apply(insertRow(this.model, ref.r + 1));
        return this.focusCell({ r: ref.r + 1, c: ref.c });
      }
      const next = this.nextRef(ref, 1, 0);
      if (next) return this.focusCell(next);
      this.apply(insertRow(this.model, rows));
      return this.focusCell({ r: this.model.rows.length - 1, c: ref.c });
    }
    if (e.key === 'Escape') {
      handled();
      return this.exit('after');
    }
    if (mod && !e.shiftKey && key === 'z') {
      handled();
      undo(this.opts.view);
      return;
    }
    if (mod && ((e.shiftKey && key === 'z') || (!e.shiftKey && key === 'y'))) {
      handled();
      redo(this.opts.view);
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && ['b', 'i', '`', 'k'].includes(key)) {
      handled();
      const wrap = key === 'b' ? '**' : key === 'i' ? '*' : key === '`' ? '`' : null;
      const sel = window.getSelection();
      const selected = sel && !sel.isCollapsed ? sel.toString() : '';
      if (wrap) insertText(`${wrap}${selected}${wrap}`);
      else insertText(`[${selected}]()`);
      return;
    }
    if (!e.key.startsWith('Arrow') || mod || e.altKey) return;
    const sel = window.getSelection();
    if (e.shiftKey) {
      // Shift+Arrow from a fully selected (or empty) cell starts a cell range.
      const len = (div.textContent ?? '').length;
      if (!(len === 0 || (sel && sel.toString().length >= len))) return;
      const head = this.step(ref, e.key);
      if (!head) return;
      handled();
      this.selectRange(ref, head);
      return;
    }
    if (!sel || !sel.isCollapsed) return;
    const offset = caretOffset(div);
    const len = (div.textContent ?? '').length;
    let next: CellRef | null = null;
    if (e.key === 'ArrowLeft' && offset === 0) next = this.nextRef(ref, 0, -1);
    else if (e.key === 'ArrowRight' && offset >= len) next = this.nextRef(ref, 0, 1);
    else if (e.key === 'ArrowUp') next = this.nextRef(ref, -1, 0);
    else if (e.key === 'ArrowDown') next = this.nextRef(ref, 1, 0);
    else return;
    handled();
    if (next) this.focusCell(next, e.key === 'ArrowRight' ? 'start' : 'end');
    else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') this.exit('after');
    else this.exit('before');
  }

  /** The neighbouring cell in an arrow direction, clamped to the table. */
  private step(ref: CellRef, key: string): CellRef | null {
    const dr = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
    const dc = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    const r = Math.max(-1, Math.min(this.model.rows.length - 1, ref.r + dr));
    const c = Math.max(0, Math.min(this.model.header.length - 1, ref.c + dc));
    return r === ref.r && c === ref.c ? null : { r, c };
  }

  private onRangeKey(e: KeyboardEvent, range: CellRange) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'Escape') {
      handled();
      return this.focusCell(this.head ?? { r: range.r0, c: range.c0 }, 'end');
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      handled();
      if (mod && e.shiftKey) {
        if (e.altKey || (this.wholeColumns(range) && !this.wholeRows(range))) this.deleteColumnsAt(range.c0, range.c1, { r: range.r0, c: range.c0 });
        else this.deleteRowsAt(range.r0, range.r1, { r: range.r0, c: range.c0 });
        return;
      }
      this.apply(clearRange(this.model, range));
      this.selectRange(this.anchor!, this.head!);
      return;
    }
    if (e.key.startsWith('Arrow') && !mod && !e.altKey) {
      handled();
      const from = this.head ?? { r: range.r0, c: range.c0 };
      const next = this.step(from, e.key) ?? from;
      if (e.shiftKey) this.selectRange(this.anchor ?? from, next);
      else this.focusCell(next, 'all');
      return;
    }
    if (e.key === 'Tab' || e.key === 'Enter') {
      handled();
      return this.focusCell(e.key === 'Tab' ? (this.head ?? { r: range.r0, c: range.c0 }) : { r: range.r0, c: range.c0 }, 'end');
    }
    if (mod && !e.shiftKey && !e.altKey && key === 'a') {
      handled();
      return this.selectRange({ r: -1, c: 0 }, { r: this.model.rows.length - 1, c: this.model.header.length - 1 });
    }
    if (mod && !e.shiftKey && key === 'z') {
      handled();
      undo(this.opts.view);
      return;
    }
    if (mod && ((e.shiftKey && key === 'z') || (!e.shiftKey && key === 'y'))) {
      handled();
      redo(this.opts.view);
      return;
    }
    if (!mod && !e.altKey && e.key.length === 1) {
      // Typing replaces the top-left cell, like a spreadsheet; the key itself goes to the cell.
      this.focusCell({ r: range.r0, c: range.c0 }, 'all');
      return;
    }
    // Everything else (copy / cut / paste, save, ...) propagates to the host.
  }

  // ---- clipboard --------------------------------------------------------------------------

  /** Payload used by menu-triggered copies (execCommand('copy') fires onCopy synchronously). */
  private pendingCopy: CellRange | null = null;

  private clipboardPayload(range: CellRange): { plain: string; html: string; cells: string[][] } {
    const cells = rangeCells(this.model, range);
    const single = cells.length === 1 && cells[0].length === 1;
    const plain = single ? cellToPlain(cells[0][0]) : rangeToMarkdown(this.model, range);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<table>${cells.map((row, i) => `<tr>${row.map((c) => (i === 0 && range.r0 < 0 ? `<th>${esc(cellToPlain(c))}</th>` : `<td>${esc(cellToPlain(c))}</td>`)).join('')}</tr>`).join('')}</table>`;
    return { plain, html, cells };
  }

  private onCopy(e: ClipboardEvent, cut: boolean) {
    const range = this.pendingCopy ?? this.range;
    if (!range || !e.clipboardData) return; // plain text copy inside a cell
    e.preventDefault();
    e.stopPropagation();
    const p = this.clipboardPayload(range);
    e.clipboardData.setData('text/plain', p.plain);
    e.clipboardData.setData('text/html', p.html);
    e.clipboardData.setData(CELLS_MIME, JSON.stringify(p.cells));
    if (cut && !this.pendingCopy) {
      this.apply(clearRange(this.model, range));
      if (this.anchor && this.head) this.selectRange(this.anchor, this.head);
    }
  }

  /** Copy a range from a menu action. */
  private copyRange(range: CellRange, cut = false) {
    this.pendingCopy = range;
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    this.pendingCopy = null;
    if (!ok) void navigator.clipboard?.writeText(this.clipboardPayload(range).plain).catch(() => undefined);
    if (cut) this.apply(clearRange(this.model, range));
  }

  private onPaste(e: ClipboardEvent) {
    const range = this.range;
    const ref = range ? { r: range.r0, c: range.c0 } : this.refOf(e.target as Element);
    if (!ref) return;
    e.preventDefault();
    e.stopPropagation();
    const dt = e.clipboardData;
    const text = dt?.getData('text/plain') ?? '';
    let grid: string[][] | null = null;
    try {
      const custom = dt?.getData(CELLS_MIME);
      if (custom) grid = JSON.parse(custom) as string[][];
    } catch {
      grid = null;
    }
    grid ??= parseClipboardGrid(text);
    if (grid && grid.length && grid[0].length === 1 && grid.length === 1 && range) {
      // One value over a range: fill every selected cell.
      const value = grid[0][0];
      grid = [];
      for (let r = range.r0; r <= range.r1; r++) grid.push(Array.from({ length: range.c1 - range.c0 + 1 }, () => value));
    }
    if (grid && grid.length && (grid.length > 1 || grid[0].length > 1 || range)) {
      const width = Math.max(...grid.map((g) => g.length));
      this.apply(pasteGrid(this.model, ref.r, ref.c, grid));
      this.selectRange(ref, { r: ref.r + grid.length - 1, c: ref.c + width - 1 });
      return;
    }
    if (range) this.focusCell(ref, 'all');
    insertText(text.replace(/\r?\n/g, '<br>'));
  }

  // ---- mouse ------------------------------------------------------------------------------

  private onMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    // Clicking a link inside a rendered cell follows it; anything else edits the cell.
    if (target.closest('a') && !target.closest('[data-raw="1"]')) return;
    e.stopPropagation();
    const ref = this.refOf(target);
    if (!ref) return;
    const range = this.range;
    if (e.button !== 0) {
      // Right click inside the selected range keeps it for the context menu.
      if (range && !inRange(range, ref)) this.clearRange();
      return;
    }
    if (e.shiftKey) {
      e.preventDefault();
      this.selectRange(this.anchor ?? this.active ?? ref, ref);
      return;
    }
    this.clearRange();
    this.dragFrom = ref;
    document.addEventListener('mouseup', this.onDocMouseUp, true);
    if (!target.closest('.table-cell-wrapper')) {
      // Cell padding: the editable element itself was not hit.
      e.preventDefault();
      this.focusCell(ref, 'end');
    }
  }

  private onMouseOver(e: MouseEvent) {
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    if (!this.hover || this.hover.r !== ref.r || this.hover.c !== ref.c) {
      this.hover = ref;
      this.placeHandles();
    }
    const from = this.dragFrom;
    if (from && e.buttons & 1 && (from.r !== ref.r || from.c !== ref.c)) this.selectRange(from, ref);
  }

  private endDrag() {
    document.removeEventListener('mouseup', this.onDocMouseUp, true);
    this.dragFrom = null;
    // The native drag may have moved the DOM selection; restore the hidden range selection.
    if (this.anchor && this.head) this.selectRange(this.anchor, this.head);
  }

  // ---- row / column handles -------------------------------------------------------------------

  private handleRef: CellRef | null = null;

  private placeHandles() {
    const range = this.range;
    const ref = this.hover ?? this.active ?? this.head ?? (range ? { r: range.r0, c: range.c0 } : null);
    const div = ref ? this.cellAt(ref) : null;
    const cell = div?.parentElement;
    const row = cell?.parentElement;
    this.handleRef = div ? ref : null;
    if (!cell || !row || !this.root.isConnected) {
      this.rowHandle.classList.remove('is-visible');
      this.colHandle.classList.remove('is-visible');
      return;
    }
    const root = this.root.getBoundingClientRect();
    const table = this.table.getBoundingClientRect();
    const wrap = this.wrapper.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    this.rowHandle.style.top = `${rr.top - root.top + rr.height / 2}px`;
    this.rowHandle.style.left = `${Math.max(table.left, wrap.left) - root.left}px`;
    this.rowHandle.classList.add('is-visible');
    const cx = cr.left + cr.width / 2;
    this.colHandle.style.left = `${cx - root.left}px`;
    this.colHandle.style.top = `${table.top - root.top}px`;
    this.colHandle.classList.toggle('is-visible', cx >= wrap.left && cx <= wrap.right);
  }

  private onHandleClick(kind: 'row' | 'col', e: MouseEvent) {
    const ref = this.handleRef;
    if (!ref) return;
    if (kind === 'row') this.selectRows(ref.r, ref.r);
    else this.selectColumns(ref.c, ref.c);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.openMenu(kind === 'row' ? this.rowMenu(ref.r, ref.r) : this.columnMenu(ref.c, ref.c), r.right + 4, r.top);
  }

  // ---- structural helpers --------------------------------------------------------------------

  private deleteRowsAt(r0: number, r1: number, focus: CellRef) {
    const a = Math.max(0, Math.min(r0, r1));
    const b = Math.max(r0, r1);
    if (b < 0 || !this.model.rows.length) return;
    this.apply(deleteRows(this.model, a, b));
    const r = Math.min(a, this.model.rows.length - 1);
    this.focusCell({ r, c: Math.min(focus.c, this.model.header.length - 1) }, 'end');
  }

  private deleteColumnsAt(c0: number, c1: number, focus: CellRef) {
    const a = Math.min(c0, c1);
    const b = Math.max(c0, c1);
    if (b - a + 1 >= this.model.header.length) return;
    this.apply(deleteColumns(this.model, a, b));
    this.focusCell({ r: Math.min(focus.r, this.model.rows.length - 1), c: Math.min(a, this.model.header.length - 1) }, 'end');
  }

  private deleteTable() {
    const view = this.opts.view;
    const from = view.posAtDOM(this.opts.host);
    if (from < 0) return;
    let to = Math.min(from + this.source.length, view.state.doc.length);
    if (view.state.doc.sliceString(to, to + 1) === '\n') to++;
    this.closeMenu();
    view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from }, userEvent: 'delete.table', scrollIntoView: true });
    view.focus();
  }

  private allCells(): CellRange {
    return { r0: -1, c0: 0, r1: this.model.rows.length - 1, c1: this.model.header.length - 1 };
  }

  // ---- menus ---------------------------------------------------------------------------------

  private rowMenu(r0: number, r1: number): MenuEntry[] {
    const rows = this.model.rows.length;
    const cols = this.model.header.length;
    const header = r0 < 0 && r1 < 0;
    const n = Math.max(r0, r1) - Math.max(0, Math.min(r0, r1)) + 1;
    const focusAt = (r: number, c = 0) => this.focusCell({ r: Math.max(-1, Math.min(r, this.model.rows.length - 1)), c: Math.min(c, this.model.header.length - 1) });
    const range = { r0, c0: 0, r1, c1: cols - 1 };
    return [
      { icon: 'arrow-up-to-line', label: 'Insert row above', disabled: r0 < 0, shortcut: key('Mod-Shift-Enter'), action: () => (this.apply(insertRow(this.model, r0)), focusAt(r0)) },
      { icon: 'arrow-down-to-line', label: 'Insert row below', shortcut: key('Mod-Enter'), action: () => (this.apply(insertRow(this.model, r1 + 1)), focusAt(r1 + 1)) },
      { icon: 'copy-plus', label: 'Duplicate row', disabled: header || r0 !== r1, action: () => (this.apply(duplicateRow(this.model, r0)), focusAt(r0 + 1)) },
      { icon: 'arrow-up', label: 'Move row up', disabled: r0 !== r1 || r0 <= 0, shortcut: key('Alt-ArrowUp'), action: () => (this.apply(moveRow(this.model, r0, r0 - 1)), this.selectRows(r0 - 1, r0 - 1)) },
      { icon: 'arrow-down', label: 'Move row down', disabled: r0 !== r1 || r0 < 0 || r0 >= rows - 1, shortcut: key('Alt-ArrowDown'), action: () => (this.apply(moveRow(this.model, r0, r0 + 1)), this.selectRows(r0 + 1, r0 + 1)) },
      'sep',
      { icon: 'copy', label: n > 1 ? `Copy ${n} rows` : 'Copy row', action: () => this.copyRange(range) },
      { icon: 'eraser', label: n > 1 ? 'Clear rows' : 'Clear row', action: () => (this.apply(clearRange(this.model, range)), this.selectRows(r0, r1)) },
      { icon: 'trash', label: n > 1 ? `Delete ${n} rows` : 'Delete row', disabled: header || !rows, shortcut: key('Mod-Shift-Backspace'), action: () => this.deleteRowsAt(r0, r1, { r: r0, c: 0 }) },
    ];
  }

  private columnMenu(c0: number, c1: number): MenuEntry[] {
    const cols = this.model.header.length;
    const n = c1 - c0 + 1;
    const range = { r0: -1, c0, r1: this.model.rows.length - 1, c1 };
    const align = (a: Align) => () => {
      let m = this.model;
      for (let c = c0; c <= c1; c++) m = setAlign(m, c, a);
      this.apply(m);
      this.selectColumns(c0, c1);
    };
    return [
      { icon: 'arrow-left-to-line', label: 'Insert column left', action: () => (this.apply(insertColumn(this.model, c0)), this.focusCell({ r: -1, c: c0 })) },
      { icon: 'arrow-right-to-line', label: 'Insert column right', action: () => (this.apply(insertColumn(this.model, c1 + 1)), this.focusCell({ r: -1, c: c1 + 1 })) },
      { icon: 'arrow-left', label: 'Move column left', disabled: n > 1 || c0 <= 0, action: () => (this.apply(moveColumn(this.model, c0, c0 - 1)), this.selectColumns(c0 - 1, c0 - 1)) },
      { icon: 'arrow-right', label: 'Move column right', disabled: n > 1 || c0 >= cols - 1, action: () => (this.apply(moveColumn(this.model, c0, c0 + 1)), this.selectColumns(c0 + 1, c0 + 1)) },
      'sep',
      { icon: 'align-left', label: 'Align left', action: align('left') },
      { icon: 'align-center', label: 'Align center', action: align('center') },
      { icon: 'align-right', label: 'Align right', action: align('right') },
      { icon: 'align-justify', label: 'Default alignment', action: align(null) },
      'sep',
      { icon: 'copy', label: n > 1 ? `Copy ${n} columns` : 'Copy column', action: () => this.copyRange(range) },
      { icon: 'eraser', label: n > 1 ? 'Clear columns' : 'Clear column', action: () => (this.apply(clearRange(this.model, { ...range, r0: 0 })), this.selectColumns(c0, c1)) },
      { icon: 'trash', label: n > 1 ? `Delete ${n} columns` : 'Delete column', disabled: n >= cols, shortcut: key('Mod-Alt-Shift-Backspace'), action: () => this.deleteColumnsAt(c0, c1, { r: -1, c: c0 }) },
    ];
  }

  private tableMenu(): MenuEntry[] {
    return [
      { icon: 'table', label: 'Copy table as Markdown', action: () => this.copyRange(this.allCells()) },
      { icon: 'code', label: 'Edit table source', action: () => this.opts.editSource() },
      { icon: 'trash', label: 'Delete table', action: () => this.deleteTable() },
    ];
  }

  private rangeMenu(range: CellRange): MenuEntry[] {
    const entries: MenuEntry[] = [
      { icon: 'copy', label: 'Copy', shortcut: key('Mod-c'), action: () => this.copyRange(range) },
      { icon: 'scissors', label: 'Cut', shortcut: key('Mod-x'), action: () => this.copyRange(range, true) },
      { icon: 'eraser', label: 'Clear cells', shortcut: key('Delete'), action: () => (this.apply(clearRange(this.model, range)), this.selectRange(this.anchor!, this.head!)) },
      'sep',
    ];
    if (this.wholeColumns(range) && !this.wholeRows(range)) entries.push(...this.columnMenu(range.c0, range.c1));
    else entries.push(...this.rowMenu(range.r0, range.r1));
    entries.push('sep', ...this.tableMenu());
    return entries;
  }

  private cellMenu(ref: CellRef): MenuEntry[] {
    const sep: MenuEntry = 'sep';
    const entries: MenuEntry[] = [...this.rowMenu(ref.r, ref.r), sep, ...this.columnMenu(ref.c, ref.c).filter((e) => e === 'sep' || !e.label.startsWith('Align')), sep, ...this.tableMenu()];
    return entries.filter((e, i, all) => !(e === 'sep' && all[i - 1] === 'sep'));
  }

  private onContextMenu(e: MouseEvent) {
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    e.preventDefault();
    e.stopPropagation();
    const range = this.range;
    this.openMenu(range && inRange(range, ref) && (range.r0 !== range.r1 || range.c0 !== range.c1) ? this.rangeMenu(range) : this.cellMenu(ref), e.clientX, e.clientY);
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
  }

  private openMenu(entries: MenuEntry[], x: number, y: number) {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu imark-menu imark-table-menu';
    menu.setAttribute('role', 'menu');
    for (const entry of entries) {
      if (entry === 'sep') {
        const s = document.createElement('div');
        s.className = 'menu-separator';
        menu.appendChild(s);
        continue;
      }
      const it = document.createElement('div');
      it.className = 'menu-item tappable' + (entry.disabled ? ' is-disabled' : '');
      it.setAttribute('role', 'menuitem');
      if (entry.disabled) it.setAttribute('aria-disabled', 'true');
      const ic = document.createElement('div');
      ic.className = 'menu-item-icon';
      ic.appendChild(svgIconElement(entry.icon));
      const tt = document.createElement('div');
      tt.className = 'menu-item-title';
      tt.textContent = entry.label;
      it.append(ic, tt);
      if (entry.shortcut) {
        const sc = document.createElement('div');
        sc.className = 'menu-item-shortcut';
        sc.textContent = entry.shortcut;
        it.appendChild(sc);
      }
      it.addEventListener('mousedown', (ev) => ev.preventDefault());
      if (!entry.disabled) {
        it.addEventListener('click', () => {
          this.closeMenu();
          entry.action();
        });
      }
      menu.appendChild(it);
    }
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    this.menu = menu;
    setTimeout(() => document.addEventListener('mousedown', this.onDocMouseDown, true));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.closeMenu();
    document.removeEventListener('mouseup', this.onDocMouseUp, true);
  }
}

// ---- helpers ------------------------------------------------------------------------------

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Human readable shortcut label (`Mod-Shift-Backspace` -> platform glyphs / names). */
function key(spec: string): string {
  const names: Record<string, [string, string]> = {
    Mod: ['⌘', 'Ctrl'],
    Alt: ['⌥', 'Alt'],
    Shift: ['⇧', 'Shift'],
    Backspace: ['⌫', 'Backspace'],
    Delete: ['⌦', 'Delete'],
    Enter: ['↩', 'Enter'],
    ArrowUp: ['↑', 'Up'],
    ArrowDown: ['↓', 'Down'],
  };
  const parts = spec.split('-').map((p) => names[p]?.[MAC ? 0 : 1] ?? p.toUpperCase());
  return parts.join(MAC ? '' : '+');
}

function inRange(range: CellRange, ref: CellRef): boolean {
  return ref.r >= range.r0 && ref.r <= range.r1 && ref.c >= range.c0 && ref.c <= range.c1;
}

function insertText(text: string) {
  if (!document.execCommand('insertText', false, text)) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  }
}

function selectAll(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function placeCaretAtStart(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length;
}
