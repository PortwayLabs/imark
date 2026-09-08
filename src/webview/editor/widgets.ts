// CodeMirror widgets rendering Obsidian-compatible DOM for images, math,
// tables, callouts, embeds, checkboxes, horizontal rules and code flairs.
import { EditorView, WidgetType } from '@codemirror/view';
import { Facet } from '@codemirror/state';
import type { LinkResolver } from '../links';
import { IMAGE_EXT, AUDIO_EXT, VIDEO_EXT, PDF_EXT, parseTarget } from '../links';
import { renderInline, renderMarkdown, renderMath, sanitize, type RenderContext } from '../render/markdownIt';
import { calloutMeta, type CalloutHeader } from '../render/callouts';
import { svgIconElement } from '../render/icons';
import { hydrateRendered } from '../render/hydrate';
import { mermaidThemeKey, mountMermaid, renderMermaid } from '../render/mermaid';
import { openDiagramPreview } from '../ui/diagramModal';
import { fitTable, type TableFitHandle } from '../render/tableFit';

export interface WidgetContext {
  resolver: LinkResolver;
  openLink(href: string): void;
  openWikilink(target: string): void;
  readFile(target: string): Promise<string | null>;
}

export const widgetContext = Facet.define<WidgetContext, WidgetContext>({
  combine: (values) => values[0],
});

/** Move the cursor to the source position of a widget's DOM node. */
function placeCursorAt(view: EditorView, dom: HTMLElement, offset = 0): void {
  const pos = view.posAtDOM(dom);
  if (pos < 0) return;
  view.dispatch({ selection: { anchor: Math.min(view.state.doc.length, pos + offset) }, scrollIntoView: false });
  view.focus();
}

function editBlockButton(view: EditorView, target: () => HTMLElement, offset = 0): HTMLElement {
  const btn = document.createElement('div');
  btn.className = 'edit-block-button';
  btn.setAttribute('aria-label', 'Edit this block');
  btn.appendChild(svgIconElement('code'));
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    placeCursorAt(view, target(), offset);
  });
  return btn;
}

// ---- Images / media ---------------------------------------------------------------

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly width: number | null,
    readonly height: number | null,
    readonly internal: boolean,
    readonly rawTarget: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.width === this.width &&
      other.height === this.height &&
      other.internal === this.internal
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const ctx = view.state.facet(widgetContext);
    const wrap: HTMLElement = document.createElement(this.internal ? 'div' : 'span');
    wrap.className = this.internal ? 'internal-embed media-embed image-embed is-loaded' : 'image-embed is-loaded';
    wrap.setAttribute('src', this.rawTarget);
    wrap.setAttribute('alt', this.alt);
    wrap.setAttribute('contenteditable', 'false');
    const url = this.internal ? ctx.resolver.resolve(this.rawTarget)?.url ?? ctx.resolver.urlForMarkdownPath(this.src) : ctx.resolver.urlForMarkdownPath(this.src);
    const name = parseTarget(this.rawTarget).path;
    let media: HTMLElement;
    if (AUDIO_EXT.test(name)) {
      const a = document.createElement('audio');
      a.controls = true;
      a.src = url;
      wrap.className = wrap.className.replace('image-embed', 'audio-embed');
      media = a;
    } else if (VIDEO_EXT.test(name)) {
      const v = document.createElement('video');
      v.controls = true;
      v.src = url;
      if (this.width) v.width = this.width;
      wrap.className = wrap.className.replace('image-embed', 'video-embed');
      media = v;
    } else if (PDF_EXT.test(name)) {
      const f = document.createElement('iframe');
      f.src = url;
      f.style.cssText = 'width:100%;height:600px;border:0';
      wrap.className = wrap.className.replace('media-embed image-embed', 'pdf-embed');
      media = f;
    } else {
      const img = document.createElement('img');
      img.src = url;
      img.alt = this.alt;
      if (this.width) img.width = this.width;
      if (this.height) img.height = this.height;
      img.draggable = false;
      img.addEventListener('error', () => {
        wrap.classList.remove('is-loaded');
        wrap.classList.add('is-unresolved');
        img.replaceWith(Object.assign(svgIconElement('image-off'), { style: 'width:1.4em;height:1.4em' }));
        const label = document.createElement('span');
        label.className = 'imark-missing-image';
        label.textContent = ` ${this.alt || this.src}`;
        wrap.appendChild(label);
      });
      media = img;
    }
    wrap.appendChild(media);
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).tagName === 'AUDIO' || (e.target as HTMLElement).tagName === 'VIDEO') return;
      e.preventDefault();
      placeCursorAt(view, wrap);
    });
    return wrap;
  }

  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

export function isMediaTarget(target: string): boolean {
  const name = parseTarget(target).path;
  return IMAGE_EXT.test(name) || AUDIO_EXT.test(name) || VIDEO_EXT.test(name) || PDF_EXT.test(name);
}

// ---- Note embeds ![[Note]] ---------------------------------------------------------

export class EmbedWidget extends WidgetType {
  constructor(readonly rawTarget: string) {
    super();
  }
  eq(other: EmbedWidget): boolean {
    return other.rawTarget === this.rawTarget;
  }
  toDOM(view: EditorView): HTMLElement {
    const ctx = view.state.facet(widgetContext);
    const target = parseTarget(this.rawTarget);
    const resolved = ctx.resolver.resolve(target.path);
    const wrap = document.createElement('div');
    wrap.className = 'internal-embed markdown-embed inline-embed' + (resolved ? ' is-loaded' : ' is-unresolved');
    wrap.setAttribute('src', this.rawTarget);
    wrap.setAttribute('contenteditable', 'false');
    const title = document.createElement('div');
    title.className = 'markdown-embed-title';
    title.textContent = target.alias ?? '';
    const content = document.createElement('div');
    content.className = 'markdown-embed-content';
    const preview = document.createElement('div');
    preview.className = 'markdown-preview-view markdown-rendered';
    const sizer = document.createElement('div');
    sizer.className = 'markdown-preview-sizer markdown-preview-section';
    preview.appendChild(sizer);
    content.appendChild(preview);
    const link = document.createElement('div');
    link.className = 'markdown-embed-link';
    link.setAttribute('aria-label', 'Open link');
    link.appendChild(svgIconElement('link'));
    link.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      ctx.openWikilink(target.path);
    });
    wrap.append(title, content, link);
    if (!resolved) {
      sizer.innerHTML = `<p class="embed-unresolved">${target.path}</p>`;
    } else {
      sizer.textContent = '…';
      ctx.readFile(target.path).then((text) => {
        if (text == null) {
          sizer.innerHTML = `<p class="embed-unresolved">${target.path}</p>`;
          return;
        }
        let body = text;
        if (target.heading) body = extractHeadingSection(text, target.heading);
        else if (target.block) body = extractBlock(text, target.block);
        const rctx: RenderContext = { resolver: ctx.resolver, depth: 1 };
        sizer.innerHTML = renderMarkdown(body, rctx);
        hydrateRendered(sizer, rctx, ctx.readFile);
      });
    }
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('a, input, button, .markdown-embed-link')) return;
      e.preventDefault();
      placeCursorAt(view, wrap);
    });
    return wrap;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

export function extractHeadingSection(text: string, heading: string): string {
  const lines = text.split('\n');
  const want = heading.trim().toLowerCase();
  let level = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start < 0) {
      if (m[2].trim().toLowerCase() === want) {
        start = i;
        level = m[1].length;
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join('\n');
    }
  }
  return start < 0 ? text : lines.slice(start).join('\n');
}

export function extractBlock(text: string, id: string): string {
  const lines = text.split('\n');
  const re = new RegExp(`\\s\\^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      // Walk back to the start of the paragraph.
      let s = i;
      while (s > 0 && lines[s - 1].trim() !== '') s--;
      return lines
        .slice(s, i + 1)
        .join('\n')
        .replace(re, '');
    }
  }
  return text;
}

// ---- Math -----------------------------------------------------------------------

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
    readonly block: boolean,
  ) {
    super();
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display && other.block === this.block;
  }
  toDOM(view: EditorView): HTMLElement {
    const el: HTMLElement = document.createElement(this.block ? 'div' : 'span');
    el.className = this.block ? 'cm-embed-block math-block-widget' : 'cm-math math math-inline is-loaded';
    el.setAttribute('contenteditable', 'false');
    if (this.block) {
      const inner = document.createElement('div');
      inner.className = 'math math-block is-loaded';
      inner.innerHTML = sanitize(renderMath(this.tex, true));
      el.appendChild(inner);
      el.appendChild(editBlockButton(view, () => el));
    } else {
      el.innerHTML = sanitize(renderMath(this.tex, this.display));
    }
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      placeCursorAt(view, el, this.block ? 0 : 1);
    });
    return el;
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

// ---- Horizontal rule --------------------------------------------------------------

export class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(view: EditorView): HTMLElement {
    const hr = document.createElement('hr');
    hr.className = 'cm-hr';
    hr.setAttribute('contenteditable', 'false');
    hr.addEventListener('mousedown', (e) => {
      e.preventDefault();
      placeCursorAt(view, hr);
    });
    return hr;
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

// ---- Task checkbox ----------------------------------------------------------------

export class CheckboxWidget extends WidgetType {
  constructor(readonly mark: string) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.mark === this.mark;
  }
  toDOM(view: EditorView): HTMLElement {
    const label = document.createElement('label');
    label.className = 'task-list-label';
    label.setAttribute('contenteditable', 'false');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'task-list-item-checkbox';
    input.setAttribute('data-task', this.mark.trim());
    input.checked = this.mark !== ' ';
    input.addEventListener('mousedown', (e) => e.preventDefault());
    input.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(label);
      if (pos < 0) return;
      const text = view.state.doc.sliceString(pos, pos + 3);
      if (!/^\[.\]$/.test(text)) return;
      const next = text[1] === ' ' ? 'x' : ' ';
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: next } });
    });
    label.appendChild(input);
    return label;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

// ---- List indentation guides --------------------------------------------------------

export class IndentWidget extends WidgetType {
  constructor(readonly levels: number) {
    super();
  }
  eq(other: IndentWidget): boolean {
    return other.levels === this.levels;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = `cm-hmd-list-indent cm-hmd-list-indent-${this.levels}`;
    for (let i = 0; i < this.levels; i++) {
      const g = document.createElement('span');
      g.className = 'cm-indent';
      span.appendChild(g);
    }
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

// ---- Code block language flair ---------------------------------------------------------

export class FlairWidget extends WidgetType {
  constructor(
    readonly lang: string,
    readonly code: () => string,
  ) {
    super();
  }
  eq(other: FlairWidget): boolean {
    return other.lang === this.lang;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'code-block-flair';
    el.setAttribute('contenteditable', 'false');
    el.setAttribute('aria-label', 'Copy');
    el.textContent = this.lang;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigator.clipboard?.writeText(this.code()).then(() => {
        const old = el.textContent;
        el.textContent = 'Copied';
        setTimeout(() => (el.textContent = old), 1200);
      });
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

// ---- Tables ----------------------------------------------------------------------

export interface TableCellInfo {
  text: string;
  from: number;
}
export interface TableInfo {
  header: TableCellInfo[];
  aligns: (string | null)[];
  rows: TableCellInfo[][];
  source: string;
}

export class TableWidget extends WidgetType {
  constructor(
    readonly info: TableInfo,
    readonly from: number,
  ) {
    super();
  }
  eq(other: TableWidget): boolean {
    return other.info.source === this.info.source;
  }
  toDOM(view: EditorView): HTMLElement {
    const ctx = view.state.facet(widgetContext);
    const rctx: RenderContext = { resolver: ctx.resolver, depth: 1 };
    const wrap = document.createElement('div');
    wrap.className = 'cm-embed-block cm-table-widget markdown-rendered';
    wrap.setAttribute('contenteditable', 'false');
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');
    const mkCell = (tag: 'th' | 'td', cell: TableCellInfo, i: number) => {
      const c = document.createElement(tag);
      const align = this.info.aligns[i];
      if (align) c.style.textAlign = align;
      const inner = document.createElement('div');
      inner.className = 'table-cell-wrapper';
      inner.innerHTML = renderInline(cell.text.trim(), rctx);
      c.appendChild(inner);
      c.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest('a')) return;
        e.preventDefault();
        const base = view.posAtDOM(wrap);
        if (base < 0) return;
        const pos = base + (cell.from - this.from) + cell.text.length - cell.text.trimEnd().length + cell.text.trim().length;
        view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) } });
        view.focus();
      });
      return c;
    };
    const hr = document.createElement('tr');
    this.info.header.forEach((c, i) => hr.appendChild(mkCell('th', c, i)));
    thead.appendChild(hr);
    for (const row of this.info.rows) {
      const tr = document.createElement('tr');
      row.forEach((c, i) => tr.appendChild(mkCell('td', c, i)));
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    const tw = document.createElement('div');
    tw.className = 'table-wrapper';
    tw.appendChild(table);
    wrap.appendChild(tw);
    wrap.appendChild(editBlockButton(view, () => wrap));
    (wrap as HTMLElement & { imarkFit?: TableFitHandle }).imarkFit = fitTable(wrap, tw, table);
    return wrap;
  }
  destroy(dom: HTMLElement): void {
    (dom as HTMLElement & { imarkFit?: TableFitHandle }).imarkFit?.dispose();
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

// ---- Callouts --------------------------------------------------------------------

export class CalloutWidget extends WidgetType {
  constructor(
    readonly header: CalloutHeader,
    readonly body: string,
    readonly source: string,
  ) {
    super();
  }
  eq(other: CalloutWidget): boolean {
    return other.source === this.source;
  }
  toDOM(view: EditorView): HTMLElement {
    const ctx = view.state.facet(widgetContext);
    const rctx: RenderContext = { resolver: ctx.resolver, depth: 1 };
    const meta = calloutMeta(this.header.type);
    const wrap = document.createElement('div');
    wrap.className = 'cm-embed-block cm-callout markdown-rendered';
    wrap.setAttribute('contenteditable', 'false');
    const callout = document.createElement('div');
    callout.className = 'callout' + (this.header.fold ? ' is-collapsible' + (this.header.fold === '-' ? ' is-collapsed' : '') : '');
    callout.setAttribute('data-callout', meta.type);
    callout.setAttribute('data-callout-metadata', this.header.metadata);
    callout.setAttribute('data-callout-fold', this.header.fold);
    const title = document.createElement('div');
    title.className = 'callout-title';
    title.setAttribute('dir', 'auto');
    const icon = document.createElement('div');
    icon.className = 'callout-icon';
    icon.appendChild(svgIconElement(meta.icon));
    const inner = document.createElement('div');
    inner.className = 'callout-title-inner';
    inner.innerHTML = this.header.title ? renderInline(this.header.title, rctx) : meta.title;
    title.append(icon, inner);
    if (this.header.fold) {
      const fold = document.createElement('div');
      fold.className = 'callout-fold' + (this.header.fold === '-' ? ' is-collapsed' : '');
      fold.appendChild(svgIconElement('chevron-down'));
      title.appendChild(fold);
      title.addEventListener('click', (e) => {
        e.stopPropagation();
        callout.classList.toggle('is-collapsed');
        fold.classList.toggle('is-collapsed');
      });
    }
    const content = document.createElement('div');
    content.className = 'callout-content';
    if (this.body.trim()) {
      content.innerHTML = renderMarkdown(this.body, rctx);
      hydrateRendered(content, rctx, ctx.readFile);
    }
    callout.append(title, content);
    wrap.appendChild(callout);
    wrap.appendChild(editBlockButton(view, () => wrap));
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('a, input, button, .callout-title, .edit-block-button')) return;
      if (t.closest('.callout-content') && window.getSelection()?.toString()) return;
      e.preventDefault();
      placeCursorAt(view, wrap);
    });
    return wrap;
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

// ---- Mermaid diagrams ----------------------------------------------------------------

export class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly themeKey = mermaidThemeKey(),
  ) {
    super();
  }
  eq(other: MermaidWidget): boolean {
    return other.code === this.code && other.themeKey === this.themeKey;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-embed-block cm-lang-mermaid markdown-rendered cm-preview-code-block';
    wrap.setAttribute('contenteditable', 'false');
    const diagram = document.createElement('div');
    diagram.className = 'mermaid';
    diagram.setAttribute('aria-label', 'Mermaid diagram — click to enlarge');
    wrap.appendChild(diagram);
    wrap.appendChild(editBlockButton(view, () => wrap, 0));
    void mountMermaid(diagram, this.code);
    diagram.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
    });
    diagram.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (diagram.classList.contains('mermaid-error')) {
        placeCursorAt(view, wrap, 0);
        return;
      }
      void renderMermaid(this.code).then((r) => {
        if (r.svg) openDiagramPreview(r.svg, 'Mermaid diagram');
      });
    });
    return wrap;
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown' && e.type !== 'click';
  }
  get estimatedHeight(): number {
    return 200;
  }
}

// ---- Raw HTML blocks ---------------------------------------------------------------

export class HtmlBlockWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly className = 'cm-embed-block cm-html-embed',
    readonly cursorOffset = 0,
  ) {
    super();
  }
  eq(other: HtmlBlockWidget): boolean {
    return other.html === this.html && other.className === this.className;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = this.className;
    wrap.setAttribute('contenteditable', 'false');
    const inner = document.createElement('div');
    inner.innerHTML = sanitize(this.html);
    wrap.appendChild(inner);
    wrap.appendChild(editBlockButton(view, () => wrap, this.cursorOffset));
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('a, input, button, .edit-block-button')) return;
      e.preventDefault();
      placeCursorAt(view, wrap, this.cursorOffset);
    });
    return wrap;
  }
  ignoreEvent(e: Event): boolean {
    return e.type !== 'mousedown';
  }
}

// ---- Hidden formatting placeholder ------------------------------------------------------

/** Zero-width widget keeping a DOM anchor for hidden markup (used for quotes). */
export class BlockquoteBorderWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-blockquote-border';
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}
