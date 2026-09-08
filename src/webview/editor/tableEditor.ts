// In-place table editing for the live preview: cells are contenteditable, the
// active cell shows its Markdown source, and every change is written back to
// the document as a re-serialized table. The widget DOM is kept alive across
// document updates (see TableWidget.updateDOM) so focus is never lost.
import type { EditorView } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import { renderInline, type RenderContext } from '../render/markdownIt';
import { svgIconElement } from '../render/icons';
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  sanitizeCell,
  serializeTable,
  setAlign,
  type Align,
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

export class TableController {
  readonly root: HTMLElement;
  readonly wrapper: HTMLElement;
  readonly table: HTMLTableElement;
  model: TableModel;
  source: string;
  private active: CellRef | null = null;
  private menu: HTMLElement | null = null;
  private disposed = false;
  private readonly onDocMouseDown = (e: MouseEvent) => {
    if (this.menu && !this.menu.contains(e.target as Node)) this.closeMenu();
  };

  constructor(private readonly opts: TableControllerOptions) {
    this.model = opts.model;
    this.source = opts.source;
    this.root = document.createElement('div');
    this.root.className = 'table-editor';
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'table-wrapper';
    this.table = document.createElement('table');
    this.wrapper.appendChild(this.table);
    this.root.appendChild(this.wrapper);

    const colBtn = document.createElement('div');
    colBtn.className = 'table-col-btn';
    colBtn.setAttribute('aria-label', 'Add column');
    colBtn.appendChild(svgIconElement('plus'));
    colBtn.addEventListener('mousedown', (e) => e.preventDefault());
    colBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.apply(insertColumn(this.model, this.model.header.length));
      this.focusCell({ r: -1, c: this.model.header.length - 1 });
    });
    const rowBtn = document.createElement('div');
    rowBtn.className = 'table-row-btn';
    rowBtn.setAttribute('aria-label', 'Add row');
    rowBtn.appendChild(svgIconElement('plus'));
    rowBtn.addEventListener('mousedown', (e) => e.preventDefault());
    rowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.apply(insertRow(this.model, this.model.rows.length));
      this.focusCell({ r: this.model.rows.length - 1, c: 0 });
    });
    this.root.append(colBtn, rowBtn);

    this.build();
    this.wrapper.addEventListener('focusin', (e) => this.onFocusIn(e));
    this.wrapper.addEventListener('focusout', (e) => this.onFocusOut(e));
    this.wrapper.addEventListener('input', (e) => this.onInput(e));
    this.wrapper.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.wrapper.addEventListener('paste', (e) => this.onPaste(e));
    this.wrapper.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    this.wrapper.addEventListener('mousedown', (e) => {
      // Clicking a link inside a rendered cell follows it; anything else edits the cell.
      const a = (e.target as HTMLElement).closest('a');
      if (a) return;
      e.stopPropagation();
    });
  }

  // ---- DOM construction ----------------------------------------------------------

  private cellAt(ref: CellRef): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(`.table-cell-wrapper[data-r="${ref.r}"][data-c="${ref.c}"]`);
  }

  private refOf(el: Element | null): CellRef | null {
    const div = el?.closest<HTMLElement>('.table-cell-wrapper');
    if (!div || !this.table.contains(div)) return null;
    return { r: parseInt(div.dataset.r ?? '0', 10), c: parseInt(div.dataset.c ?? '0', 10) };
  }

  private textOf(ref: CellRef): string {
    return ref.r < 0 ? this.model.header[ref.c] ?? '' : this.model.rows[ref.r]?.[ref.c] ?? '';
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
  }

  /** Reconcile the DOM with a new model (called from TableWidget.updateDOM). */
  update(model: TableModel, source: string) {
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
  }

  // ---- editing ---------------------------------------------------------------------------

  private onFocusIn(e: FocusEvent) {
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    const div = this.cellAt(ref);
    if (!div || div.dataset.raw === '1') return;
    this.active = ref;
    div.dataset.raw = '1';
    div.textContent = this.textOf(ref);
    div.parentElement?.classList.add('is-editing');
    this.opts.host.classList.add('is-editing');
    // Park the editor selection right after the table so that history (undo/redo)
    // and scrollIntoView keep the viewport at the table instead of jumping away.
    const from = this.opts.view.posAtDOM(this.opts.host);
    if (from >= 0) {
      const to = Math.min(from + this.source.length, this.opts.view.state.doc.length);
      const head = this.opts.view.state.selection.main.head;
      if (head !== to) this.opts.view.dispatch({ selection: { anchor: to } });
    }
  }

  private onFocusOut(e: FocusEvent) {
    const div = (e.target as HTMLElement).closest<HTMLElement>('.table-cell-wrapper');
    if (!div || !this.table.contains(div)) return;
    const ref = this.refOf(div);
    if (!ref) return;
    this.commitCell(div, ref);
    div.parentElement?.classList.remove('is-editing');
    this.render(div, this.textOf(ref));
    if (this.active && this.active.r === ref.r && this.active.c === ref.c) this.active = null;
    // Delay so that focus moving to another cell keeps the host marked as editing.
    setTimeout(() => {
      if (!this.table.contains(document.activeElement)) this.opts.host.classList.remove('is-editing');
    }, 0);
  }

  private onInput(e: Event) {
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    const div = this.cellAt(ref);
    if (div) this.commitCell(div, ref);
  }

  private commitCell(div: HTMLElement, ref: CellRef) {
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
    this.model = model;
    this.commit();
    // The dispatch above rebuilt the DOM synchronously via updateDOM when the structure changed.
  }

  focusCell(ref: CellRef, caret: 'start' | 'end' | 'all' = 'all') {
    const div = this.cellAt(ref);
    if (!div) return;
    div.focus();
    if (caret === 'all') selectAll(div);
    else if (caret === 'end') placeCaretAtEnd(div);
    else placeCaretAtStart(div);
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

  private onKeyDown(e: KeyboardEvent) {
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    e.stopPropagation();
    const div = this.cellAt(ref)!;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Tab') {
      e.preventDefault();
      const next = this.nextRef(ref, 0, e.shiftKey ? -1 : 1);
      if (next) return this.focusCell(next);
      if (!e.shiftKey) {
        this.apply(insertRow(this.model, this.model.rows.length));
        this.focusCell({ r: this.model.rows.length - 1, c: 0 });
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) return insertText('<br>');
      if (e.altKey || mod) {
        this.apply(insertRow(this.model, ref.r + 1));
        return this.focusCell({ r: ref.r + 1, c: ref.c });
      }
      const next = this.nextRef(ref, 1, 0);
      if (next) return this.focusCell(next);
      this.apply(insertRow(this.model, this.model.rows.length));
      return this.focusCell({ r: this.model.rows.length - 1, c: ref.c });
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      div.blur();
      const from = this.opts.view.posAtDOM(this.opts.host);
      const after = from + this.source.length;
      this.opts.view.dispatch({ selection: { anchor: Math.min(after, this.opts.view.state.doc.length) } });
      this.opts.view.focus();
      return;
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo(this.opts.view);
      return;
    }
    if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      redo(this.opts.view);
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && ['b', 'i', '`', 'k'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const wrap = e.key.toLowerCase() === 'b' ? '**' : e.key.toLowerCase() === 'i' ? '*' : e.key === '`' ? '`' : null;
      const sel = window.getSelection();
      const selected = sel && !sel.isCollapsed ? sel.toString() : '';
      if (wrap) insertText(`${wrap}${selected}${wrap}`);
      else insertText(`[${selected}]()`);
      return;
    }
    if (e.key.startsWith('Arrow') && !e.shiftKey && !mod && !e.altKey) {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed) return;
      const offset = caretOffset(div);
      const len = (div.textContent ?? '').length;
      let next: CellRef | null = null;
      if (e.key === 'ArrowLeft' && offset === 0) next = this.nextRef(ref, 0, -1);
      else if (e.key === 'ArrowRight' && offset >= len) next = this.nextRef(ref, 0, 1);
      else if (e.key === 'ArrowUp') next = this.nextRef(ref, -1, 0);
      else if (e.key === 'ArrowDown') next = this.nextRef(ref, 1, 0);
      if (next) {
        e.preventDefault();
        this.focusCell(next, e.key === 'ArrowLeft' ? 'end' : e.key === 'ArrowRight' ? 'start' : 'end');
      } else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && offset >= len)) {
        // Leave the table below.
        e.preventDefault();
        div.blur();
        const from = this.opts.view.posAtDOM(this.opts.host);
        const after = Math.min(from + this.source.length + 1, this.opts.view.state.doc.length);
        this.opts.view.dispatch({ selection: { anchor: after }, scrollIntoView: true });
        this.opts.view.focus();
      } else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && offset === 0)) {
        e.preventDefault();
        div.blur();
        const from = this.opts.view.posAtDOM(this.opts.host);
        this.opts.view.dispatch({ selection: { anchor: Math.max(0, from - 1) }, scrollIntoView: true });
        this.opts.view.focus();
      }
    }
  }

  private onPaste(e: ClipboardEvent) {
    if (!this.refOf(e.target as Element)) return;
    e.preventDefault();
    e.stopPropagation();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    insertText(text.replace(/\r?\n/g, '<br>'));
  }

  // ---- context menu ---------------------------------------------------------------------------

  private onContextMenu(e: MouseEvent) {
    const ref = this.refOf(e.target as Element);
    if (!ref) return;
    e.preventDefault();
    e.stopPropagation();
    this.openMenu(ref, e.clientX, e.clientY);
  }

  private closeMenu() {
    this.menu?.remove();
    this.menu = null;
    document.removeEventListener('mousedown', this.onDocMouseDown, true);
  }

  private openMenu(ref: CellRef, x: number, y: number) {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu imark-menu imark-table-menu';
    const item = (icon: string, label: string, action: () => void, disabled = false) => {
      const it = document.createElement('div');
      it.className = 'menu-item tappable' + (disabled ? ' is-disabled' : '');
      const ic = document.createElement('div');
      ic.className = 'menu-item-icon';
      ic.appendChild(svgIconElement(icon));
      const tt = document.createElement('div');
      tt.className = 'menu-item-title';
      tt.textContent = label;
      it.append(ic, tt);
      if (!disabled) {
        it.addEventListener('mousedown', (ev) => ev.preventDefault());
        it.addEventListener('click', () => {
          this.closeMenu();
          action();
        });
      }
      return it;
    };
    const sep = () => {
      const s = document.createElement('div');
      s.className = 'menu-separator';
      return s;
    };
    const rowIndex = ref.r; // -1 header
    const focusAfter = (r: number, c: number) => this.focusCell({ r: Math.min(r, this.model.rows.length - 1), c: Math.min(c, this.model.header.length - 1) });
    menu.append(
      item('arrow-up-to-line', 'Insert row above', () => {
        this.apply(insertRow(this.model, Math.max(0, rowIndex)));
        focusAfter(Math.max(0, rowIndex), ref.c);
      }, rowIndex < 0),
      item('arrow-down-to-line', 'Insert row below', () => {
        this.apply(insertRow(this.model, rowIndex + 1));
        focusAfter(rowIndex + 1, ref.c);
      }),
      item('trash', 'Delete row', () => {
        this.apply(deleteRow(this.model, rowIndex));
        focusAfter(Math.min(rowIndex, this.model.rows.length - 1), ref.c);
      }, rowIndex < 0 || this.model.rows.length === 0),
      sep(),
      item('arrow-left-to-line', 'Insert column left', () => {
        this.apply(insertColumn(this.model, ref.c));
        focusAfter(ref.r, ref.c);
      }),
      item('arrow-right-to-line', 'Insert column right', () => {
        this.apply(insertColumn(this.model, ref.c + 1));
        focusAfter(ref.r, ref.c + 1);
      }),
      item('trash', 'Delete column', () => {
        this.apply(deleteColumn(this.model, ref.c));
        focusAfter(ref.r, Math.min(ref.c, this.model.header.length - 1));
      }, this.model.header.length <= 1),
      sep(),
      item('align-left', 'Align left', () => this.apply(setAlign(this.model, ref.c, 'left'))),
      item('align-center', 'Align center', () => this.apply(setAlign(this.model, ref.c, 'center'))),
      item('align-right', 'Align right', () => this.apply(setAlign(this.model, ref.c, 'right'))),
      item('align-justify', 'Default alignment', () => this.apply(setAlign(this.model, ref.c, null as Align))),
      sep(),
      item('code', 'Edit table source', () => this.opts.editSource()),
    );
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
    this.menu = menu;
    setTimeout(() => document.addEventListener('mousedown', this.onDocMouseDown, true));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.closeMenu();
  }
}

// ---- selection helpers --------------------------------------------------------------------

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
