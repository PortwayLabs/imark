// Live preview decorations: Obsidian-compatible classes for Markdown structure,
// hidden formatting characters when the cursor is elsewhere, and inline widgets.
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { Facet, type EditorState, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { highlightTree } from '@lezer/highlight';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { obsidianHighlightStyle } from './highlightStyle';
import { CheckboxWidget, FlairWidget, HrWidget, ImageWidget, IndentWidget, MathWidget, EmbedWidget, isMediaTarget, widgetContext } from './widgets';
import { parseTarget } from '../links';
import type { EditorConfig } from '../../shared/protocol';

/** Whether formatting is hidden (live preview) or shown (source mode). */
export const livePreviewEnabled = Facet.define<boolean, boolean>({ combine: (v) => (v.length ? v[0] : true) });
export const editorConfigFacet = Facet.define<EditorConfig, EditorConfig | null>({ combine: (v) => (v.length ? v[0] : null) });

const hide = Decoration.replace({});

export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

function mark(cls: string, attrs?: Record<string, string>) {
  return Decoration.mark(attrs ? { class: cls, attributes: attrs } : { class: cls });
}

interface LineInfo {
  classes: Set<string>;
  attrs: Record<string, string>;
}

class Builder {
  decos: Range<Decoration>[] = [];
  lines = new Map<number, LineInfo>();
  listItems: { node: SyntaxNode; depth: number }[] = [];
  itemFirstLines = new Set<number>();
  state: EditorState;
  live: boolean;
  doc;
  tree;

  constructor(readonly view: EditorView) {
    this.state = view.state;
    this.doc = view.state.doc;
    this.live = view.state.facet(livePreviewEnabled);
    this.tree = syntaxTree(view.state);
  }

  active(from: number, to: number): boolean {
    return selectionTouches(this.state, from, to);
  }

  lineActive(pos: number): boolean {
    const l = this.doc.lineAt(pos);
    return this.active(l.from, l.to);
  }

  line(lineFrom: number, cls: string, attrs?: Record<string, string>) {
    let info = this.lines.get(lineFrom);
    if (!info) {
      info = { classes: new Set(), attrs: {} };
      this.lines.set(lineFrom, info);
    }
    for (const c of cls.split(/\s+/)) if (c) info.classes.add(c);
    if (attrs) Object.assign(info.attrs, attrs);
  }

  add(from: number, to: number, deco: Decoration) {
    if (to < from) return;
    if (from === to && !(deco.spec as { widget?: unknown }).widget) return;
    this.decos.push(deco.range(from, to));
  }

  hideRange(from: number, to: number) {
    if (to > from) this.decos.push(hide.range(from, to));
  }

  widget(pos: number, w: WidgetType, side = 1) {
    this.decos.push(Decoration.widget({ widget: w, side }).range(pos));
  }

  replace(from: number, to: number, w: WidgetType) {
    if (to > from) this.decos.push(Decoration.replace({ widget: w }).range(from, to));
  }

  text(from: number, to: number) {
    return this.doc.sliceString(from, to);
  }

  build(from: number, to: number) {
    this.tree.iterate({ from, to, enter: (n) => this.enter(n) });
  }

  finish(): DecorationSet {
    this.listContinuations();
    for (const [lineFrom, info] of this.lines) {
      const spec: { class: string; attributes?: Record<string, string> } = { class: [...info.classes].join(' ') };
      if (Object.keys(info.attrs).length) spec.attributes = info.attrs;
      this.decos.push(Decoration.line(spec).range(lineFrom));
    }
    return Decoration.set(this.decos, true);
  }

  // ---- node handlers -------------------------------------------------------------

  enter(n: SyntaxNodeRef): boolean | void {
    const name = n.name;
    if (name.startsWith('ATXHeading')) return this.heading(n.node, parseInt(name.slice(10), 10));
    if (name.startsWith('SetextHeading')) return this.setextHeading(n.node, parseInt(name.slice(13), 10));
    switch (name) {
      case 'Emphasis':
        return this.inlineWrap(n.node, 'cm-em', 'EmphasisMark', 'cm-formatting cm-formatting-em');
      case 'StrongEmphasis':
        return this.inlineWrap(n.node, 'cm-strong', 'EmphasisMark', 'cm-formatting cm-formatting-strong');
      case 'Strikethrough':
        return this.inlineWrap(n.node, 'cm-strikethrough', 'StrikethroughMark', 'cm-formatting cm-formatting-strikethrough');
      case 'Highlight':
        return this.inlineWrap(n.node, 'cm-highlight', 'HighlightMark', 'cm-formatting cm-formatting-highlight');
      case 'Superscript':
        return this.inlineWrap(n.node, 'cm-superscript', 'SuperscriptMark', 'cm-formatting cm-formatting-superscript');
      case 'Subscript':
        return this.inlineWrap(n.node, 'cm-subscript', 'SubscriptMark', 'cm-formatting cm-formatting-subscript');
      case 'InlineCode':
        return this.inlineCode(n.node);
      case 'Link':
        return this.link(n.node);
      case 'Image':
        return this.image(n.node);
      case 'WikiLink':
        return this.wikilink(n.node, false);
      case 'Embed':
        return this.wikilink(n.node, true);
      case 'Autolink':
      case 'URL':
        this.add(n.from, n.to, mark('cm-url'));
        return false;
      case 'Tag':
        return this.tag(n.node);
      case 'InlineMath':
        return this.inlineMath(n.node);
      case 'BlockMath':
        return this.blockMath(n.node);
      case 'ObsidianComment':
        return this.comment(n.node);
      case 'ObsidianCommentBlock':
        this.add(n.from, n.to, mark('cm-comment'));
        return false;
      case 'Comment':
      case 'CommentBlock':
        this.add(n.from, n.to, mark('cm-comment'));
        return false;
      case 'Escape':
        if (this.live && !this.active(n.from, n.to)) this.hideRange(n.from, n.from + 1);
        else this.add(n.from, n.from + 1, mark('cm-formatting cm-formatting-escape cm-escape'));
        return false;
      case 'HTMLTag':
      case 'HTMLBlock':
        this.add(n.from, n.to, mark('cm-html-embed'));
        this.highlightCode(n.from, n.to, '');
        return false;
      case 'Blockquote':
        return this.blockquote(n.node);
      case 'QuoteMark':
        return this.quoteMark(n.node);
      case 'ListItem':
        return this.listItem(n.node);
      case 'FencedCode':
        return this.fencedCode(n.node);
      case 'CodeBlock':
        return this.indentedCode(n.node);
      case 'HorizontalRule':
        return this.hr(n.node);
      case 'Table':
        return this.table(n.node);
      case 'Frontmatter':
        return this.frontmatter(n.node);
      case 'FootnoteRef':
        this.add(n.from, n.to, mark('cm-footref'));
        return false;
      case 'LinkReference':
        this.add(n.from, n.to, mark('cm-link cm-link-reference'));
        return false;
      case 'HardBreak':
        this.add(n.from, n.to, mark('cm-hard-break'));
        return false;
      case 'Emoji':
        this.add(n.from, n.to, mark('cm-emoji'));
        return false;
      case 'Task':
        return this.task(n.node);
    }
    return undefined;
  }

  heading(node: SyntaxNode, level: number): boolean {
    const line = this.doc.lineAt(node.from);
    this.line(line.from, `HyperMD-header HyperMD-header-${level}`);
    const active = !this.live || this.active(line.from, line.to);
    let first = true;
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name !== 'HeaderMark') continue;
      if (!active) {
        // Hide `# ` (and a trailing closing sequence).
        const after = first && this.text(c.to, c.to + 1) === ' ' ? c.to + 1 : c.to;
        const before = !first && this.text(c.from - 1, c.from) === ' ' ? c.from - 1 : c.from;
        this.hideRange(before, after);
      } else {
        this.add(c.from, c.to, mark(`cm-formatting cm-formatting-header cm-formatting-header-${level} cm-header cm-header-${level}`));
      }
      first = false;
    }
    this.add(node.from, node.to, mark(`cm-header cm-header-${level}`));
    return true; // descend for inline formatting
  }

  setextHeading(node: SyntaxNode, level: number): boolean {
    const line = this.doc.lineAt(node.from);
    this.line(line.from, `HyperMD-header HyperMD-header-${level}`);
    const markNode = node.getChild('HeaderMark');
    if (markNode) {
      const ml = this.doc.lineAt(markNode.from);
      this.line(ml.from, `HyperMD-header-line HyperMD-header-line-${level}`);
      this.add(markNode.from, markNode.to, mark(`cm-formatting cm-formatting-header cm-formatting-header-${level} cm-header cm-header-${level}`));
      this.add(node.from, markNode.from, mark(`cm-header cm-header-${level}`));
    } else {
      this.add(node.from, node.to, mark(`cm-header cm-header-${level}`));
    }
    return true;
  }

  inlineWrap(node: SyntaxNode, cls: string, markName: string, markCls: string): boolean {
    const active = !this.live || this.active(node.from, node.to);
    this.add(node.from, node.to, mark(cls));
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name !== markName) continue;
      if (!active) this.hideRange(c.from, c.to);
      else this.add(c.from, c.to, mark(`${markCls} ${cls}`));
    }
    return true;
  }

  inlineCode(node: SyntaxNode): boolean {
    const active = !this.live || this.active(node.from, node.to);
    this.add(node.from, node.to, mark('cm-inline-code'));
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.name !== 'CodeMark') continue;
      if (!active) this.hideRange(c.from, c.to);
      else this.add(c.from, c.to, mark('cm-formatting cm-formatting-code cm-inline-code'));
    }
    return false;
  }

  link(node: SyntaxNode): boolean {
    const active = !this.live || this.active(node.from, node.to);
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    const href = url ? this.text(url.from, url.to) : '';
    const textFrom = marks.length ? marks[0].to : node.from;
    const textTo = marks.length > 1 ? marks[1].from : node.to;
    this.add(textFrom, textTo, mark('cm-link cm-underline', { 'data-href': href }));
    if (!active) {
      if (marks.length) this.hideRange(marks[0].from, marks[0].to);
      if (marks.length > 1) this.hideRange(marks[1].from, node.to);
    } else {
      marks.forEach((m, i) => {
        const inUrl = i >= 2;
        this.add(m.from, m.to, mark(inUrl ? 'cm-formatting cm-formatting-link-string cm-string cm-url' : 'cm-formatting cm-formatting-link cm-link'));
      });
      if (url) this.add(url.from, url.to, mark('cm-string cm-url'));
      const title = node.getChild('LinkTitle');
      if (title) this.add(title.from, title.to, mark('cm-string cm-link-title'));
      const label = node.getChild('LinkLabel');
      if (label) this.add(label.from, label.to, mark('cm-link cm-link-label'));
    }
    return true;
  }

  image(node: SyntaxNode): boolean {
    const active = !this.live || this.active(node.from, node.to);
    const marks = node.getChildren('LinkMark');
    const url = node.getChild('URL');
    if (!active && url) {
      const altFrom = marks.length ? marks[0].to : node.from + 2;
      const altTo = marks.length > 1 ? marks[1].from : altFrom;
      const rawAlt = this.text(altFrom, altTo);
      const m = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(rawAlt);
      const alt = m ? m[1] : rawAlt;
      const width = m ? parseInt(m[2], 10) : null;
      const height = m && m[3] ? parseInt(m[3], 10) : null;
      this.replace(node.from, node.to, new ImageWidget(this.text(url.from, url.to), alt, width, height, false, this.text(url.from, url.to)));
      return false;
    }
    marks.forEach((m, i) => {
      this.add(m.from, m.to, mark(i >= 2 ? 'cm-formatting cm-formatting-link-string cm-string cm-url' : 'cm-formatting cm-formatting-image cm-image cm-image-marker'));
    });
    if (marks.length > 1) this.add(marks[0].to, marks[1].from, mark('cm-image cm-image-alt-text cm-link'));
    if (url) this.add(url.from, url.to, mark('cm-string cm-url'));
    return false;
  }

  wikilink(node: SyntaxNode, embed: boolean): boolean {
    const ctx = this.state.facet(widgetContext);
    const target = node.getChild('WikiLinkTarget');
    const alias = node.getChild('WikiLinkAlias');
    const pipe = node.getChild('WikiLinkPipe');
    const marks = node.getChildren(embed ? 'EmbedMark' : 'WikiLinkMark');
    const rawTarget = target ? this.text(target.from, target.to) : '';
    const rawInner = this.text(marks[0]?.to ?? node.from, marks[1]?.from ?? node.to);
    const active = !this.live || this.active(node.from, node.to);
    const resolved = rawTarget && ctx ? ctx.resolver.resolve(rawTarget) : null;
    const unresolved = rawTarget && !resolved && !parseTarget(rawTarget).path.startsWith('#') && parseTarget(rawTarget).path !== '';

    if (!active && embed) {
      if (isMediaTarget(rawInner)) {
        const t = parseTarget(rawInner);
        this.replace(node.from, node.to, new ImageWidget(t.path, t.alias ?? t.path, t.width, t.height, true, rawInner));
      } else {
        this.replace(node.from, node.to, new EmbedWidget(rawInner));
      }
      return false;
    }
    const linkCls = `cm-hmd-internal-link${unresolved ? ' is-unresolved' : ''}`;
    if (!active) {
      for (const m of marks) this.hideRange(m.from, m.to);
      if (alias && pipe) {
        this.hideRange(target ? target.from : pipe.from, pipe.to);
        this.add(alias.from, alias.to, mark(`${linkCls} cm-link-alias`, { 'data-href': rawTarget }));
      } else if (target) {
        this.add(target.from, target.to, mark(linkCls, { 'data-href': rawTarget }));
      }
      return false;
    }
    marks.forEach((m, i) =>
      this.add(m.from, m.to, mark(`cm-formatting cm-formatting-link cm-formatting-link-${i === 0 ? 'start' : 'end'}${embed ? ' cm-formatting-embed' : ''}`)),
    );
    if (target) this.add(target.from, target.to, mark(linkCls, { 'data-href': rawTarget }));
    if (pipe) this.add(pipe.from, pipe.to, mark('cm-hmd-internal-link cm-link-alias-pipe'));
    if (alias) this.add(alias.from, alias.to, mark('cm-hmd-internal-link cm-link-alias'));
    return false;
  }

  tag(node: SyntaxNode): boolean {
    const name = this.text(node.from + 1, node.to).replace(/\//g, '-');
    this.add(node.from, node.from + 1, mark(`cm-hashtag cm-hashtag-begin cm-meta cm-tag-${name}`));
    this.add(node.from + 1, node.to, mark(`cm-hashtag cm-hashtag-end cm-meta cm-tag-${name}`));
    return false;
  }

  inlineMath(node: SyntaxNode): boolean {
    const marks = node.getChildren('MathMark');
    const active = !this.live || this.active(node.from, node.to);
    if (!active && marks.length === 2) {
      const tex = this.text(marks[0].to, marks[1].from);
      this.replace(node.from, node.to, new MathWidget(tex, marks[0].to - marks[0].from === 2, false));
      return false;
    }
    this.add(node.from, node.to, mark('cm-math'));
    for (const m of marks) this.add(m.from, m.to, mark('cm-formatting cm-formatting-math cm-math'));
    return false;
  }

  blockMath(node: SyntaxNode): boolean {
    const startLine = this.doc.lineAt(node.from);
    const endLine = this.doc.lineAt(node.to);
    for (let n = startLine.number; n <= endLine.number; n++) this.line(this.doc.line(n).from, 'HyperMD-math cm-math-block');
    this.add(node.from, node.to, mark('cm-math'));
    for (const m of node.getChildren('MathMark')) this.add(m.from, m.to, mark('cm-formatting cm-formatting-math cm-math'));
    return false;
  }

  comment(node: SyntaxNode): boolean {
    if (this.live && !this.active(node.from, node.to)) {
      this.hideRange(node.from, node.to);
      return false;
    }
    this.add(node.from, node.to, mark('cm-comment'));
    for (const m of node.getChildren('ObsidianCommentMark')) this.add(m.from, m.to, mark('cm-formatting cm-formatting-comment cm-comment'));
    return false;
  }

  blockquote(node: SyntaxNode): boolean {
    let depth = 1;
    for (let p = node.parent; p; p = p.parent) if (p.name === 'Blockquote') depth++;
    const startLine = this.doc.lineAt(node.from);
    const endLine = this.doc.lineAt(node.to);
    for (let n = startLine.number; n <= endLine.number; n++) {
      const l = this.doc.line(n);
      this.line(l.from, `HyperMD-quote HyperMD-quote-${depth}`, { 'data-quote-depth': String(depth) });
    }
    this.add(node.from, node.to, mark(`cm-quote cm-quote-${depth}`));
    return true;
  }

  quoteMark(node: SyntaxNode): boolean {
    let depth = 0;
    for (let p = node.parent; p; p = p.parent) if (p.name === 'Blockquote') depth++;
    const lineActive = !this.live || this.lineActive(node.from);
    if (!lineActive) {
      const after = this.text(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
      this.hideRange(node.from, after);
    } else {
      this.add(node.from, node.to, mark(`cm-formatting cm-formatting-quote cm-formatting-quote-${depth} cm-quote cm-quote-${depth}`));
    }
    return false;
  }

  listItem(node: SyntaxNode): boolean {
    let depth = 1;
    for (let p = node.parent; p; p = p.parent) if (p.name === 'ListItem') depth++;
    const ordered = node.parent?.name === 'OrderedList';
    const markNode = node.getChild('ListMark');
    const line = this.doc.lineAt(node.from);
    const task = node.getChild('Task');
    const taskMark = task?.getChild('TaskMarker');
    const taskChar = taskMark ? this.text(taskMark.from + 1, taskMark.to - 1) : null;
    const attrs: Record<string, string> = { style: `--imark-list-level:${depth}` };
    let cls = `HyperMD-list-line HyperMD-list-line-${depth}`;
    if (taskChar !== null) {
      cls += ' HyperMD-task-line';
      attrs['data-task'] = taskChar.trim();
    }
    this.line(line.from, cls, attrs);
    // Leading indentation before the marker.
    if (markNode) {
      if (markNode.from > line.from) {
        if (this.live) this.replace(line.from, markNode.from, new IndentWidget(depth - 1));
        else this.add(line.from, markNode.from, mark(`cm-hmd-list-indent cm-hmd-list-indent-${depth - 1}`));
      }
      const markEnd = this.text(markNode.to, markNode.to + 1) === ' ' ? markNode.to + 1 : markNode.to;
      this.add(markNode.from, markEnd, mark(`cm-formatting cm-formatting-list cm-formatting-list-${ordered ? 'ol' : 'ul'} cm-list-${depth}`));
      if (!ordered && this.live) this.add(markNode.from, markNode.to, mark('list-bullet'));
    }
    this.listItems.push({ node, depth });
    this.itemFirstLines.add(line.from);
    return true;
  }

  /** Lines inside list items that are not item starts get hanging indentation (deepest item wins). */
  listContinuations() {
    const levels = new Map<number, number>();
    for (const { node, depth } of this.listItems) {
      const first = this.doc.lineAt(node.from).number;
      const last = this.doc.lineAt(node.to).number;
      for (let n = first + 1; n <= last; n++) {
        const l = this.doc.line(n);
        if (this.itemFirstLines.has(l.from) || l.text.trim() === '') continue;
        levels.set(l.from, depth);
      }
    }
    for (const [from, depth] of levels) {
      const info = this.lines.get(from);
      const isCode = info ? [...info.classes].some((c) => c.startsWith('HyperMD-codeblock')) : false;
      this.line(from, `HyperMD-list-line HyperMD-list-line-${depth} imark-list-continuation`, { style: `--imark-list-level:${depth}` });
      if (isCode || !this.live) continue;
      const text = this.doc.lineAt(from).text;
      const ws = /^\s+/.exec(text)?.[0].length ?? 0;
      if (ws > 0) this.replace(from, from + ws, new IndentWidget(depth));
    }
  }

  task(node: SyntaxNode): boolean {
    const markNode = node.getChild('TaskMarker');
    if (!markNode) return true;
    const ch = this.text(markNode.from + 1, markNode.to - 1);
    if (this.live) {
      const end = this.text(markNode.to, markNode.to + 1) === ' ' ? markNode.to + 1 : markNode.to;
      this.replace(markNode.from, end, new CheckboxWidget(ch));
    } else {
      this.add(markNode.from, markNode.to, mark('cm-formatting cm-formatting-task cm-meta'));
    }
    return true;
  }

  fencedCode(node: SyntaxNode): boolean {
    const startLine = this.doc.lineAt(node.from);
    const endLine = this.doc.lineAt(node.to);
    const marks = node.getChildren('CodeMark');
    const info = node.getChild('CodeInfo');
    const closed = marks.length > 1 && this.doc.lineAt(marks[1].from).number === endLine.number;
    const active = !this.live || this.active(startLine.from, endLine.to);
    for (let n = startLine.number; n <= endLine.number; n++) {
      const l = this.doc.line(n);
      let cls = 'HyperMD-codeblock HyperMD-codeblock-bg';
      if (n === startLine.number) cls += ' HyperMD-codeblock-begin HyperMD-codeblock-begin-bg';
      if (n === endLine.number && closed) cls += ' HyperMD-codeblock-end HyperMD-codeblock-end-bg';
      this.line(l.from, cls);
    }
    const lang = info ? this.text(info.from, info.to).trim().split(/\s+/)[0] : '';
    if (!active) {
      for (const m of marks) this.hideRange(m.from, m.to);
      if (info) this.hideRange(info.from, info.to);
    } else {
      for (const m of marks) this.add(m.from, m.to, mark('cm-formatting cm-formatting-code-block cm-hmd-codeblock'));
      if (info) this.add(info.from, info.to, mark('cm-hmd-codeblock cm-code-info'));
    }
    if (lang && this.live) {
      const codeFrom = startLine.to + 1;
      const codeTo = closed ? this.doc.lineAt(marks[1].from).from - 1 : node.to;
      this.widget(startLine.to, new FlairWidget(lang, () => this.doc.sliceString(codeFrom, Math.max(codeFrom, codeTo))), 1);
    }
    const codeStart = startLine.to;
    const codeEnd = closed ? this.doc.lineAt(marks[1].from).from : node.to;
    if (codeEnd > codeStart) {
      this.add(codeStart, codeEnd, mark('cm-hmd-codeblock'));
      this.highlightCode(codeStart, codeEnd, lang);
    }
    return false;
  }

  indentedCode(node: SyntaxNode): boolean {
    const startLine = this.doc.lineAt(node.from);
    const endLine = this.doc.lineAt(node.to);
    for (let n = startLine.number; n <= endLine.number; n++) {
      const l = this.doc.line(n);
      let cls = 'HyperMD-codeblock HyperMD-codeblock-bg';
      if (n === startLine.number) cls += ' HyperMD-codeblock-begin HyperMD-codeblock-begin-bg';
      if (n === endLine.number) cls += ' HyperMD-codeblock-end HyperMD-codeblock-end-bg';
      this.line(l.from, cls);
    }
    this.add(node.from, node.to, mark('cm-hmd-codeblock'));
    return false;
  }

  highlightCode(from: number, to: number, _lang: string) {
    highlightTree(
      this.tree,
      obsidianHighlightStyle,
      (f, t, cls) => {
        if (t > f) this.add(f, t, mark(cls));
      },
      from,
      to,
    );
  }

  hr(node: SyntaxNode): boolean {
    const line = this.doc.lineAt(node.from);
    this.line(line.from, 'HyperMD-hr');
    if (this.live && !this.active(line.from, line.to)) {
      this.replace(line.from, line.to, new HrWidget());
    } else {
      this.add(node.from, node.to, mark('cm-hr cm-formatting cm-formatting-hr'));
    }
    return false;
  }

  table(node: SyntaxNode): boolean {
    const startLine = this.doc.lineAt(node.from);
    const endLine = this.doc.lineAt(node.to);
    let i = 0;
    for (let n = startLine.number; n <= endLine.number; n++, i++) {
      const l = this.doc.line(n);
      this.line(l.from, `HyperMD-table-row HyperMD-table-row-${i} HyperMD-table-1`);
    }
    for (const d of node.getChildren('TableDelimiter')) this.add(d.from, d.to, mark('cm-formatting cm-formatting-table cm-hmd-table-sep'));
    const header = node.getChild('TableHeader');
    if (header) {
      for (const c of header.getChildren('TableCell')) this.add(c.from, c.to, mark('cm-strong cm-table-header'));
      for (const d of header.getChildren('TableDelimiter')) this.add(d.from, d.to, mark('cm-formatting cm-formatting-table cm-hmd-table-sep'));
    }
    for (const row of node.getChildren('TableRow')) {
      for (const d of row.getChildren('TableDelimiter')) this.add(d.from, d.to, mark('cm-formatting cm-formatting-table cm-hmd-table-sep'));
    }
    return true;
  }

  frontmatter(node: SyntaxNode): boolean {
    const startLine = this.doc.lineAt(node.from);
    const endLine = this.doc.lineAt(node.to);
    for (let n = startLine.number; n <= endLine.number; n++) this.line(this.doc.line(n).from, 'HyperMD-frontmatter');
    this.add(node.from, node.to, mark('cm-hmd-frontmatter'));
    for (const m of node.getChildren('FrontmatterMark')) this.add(m.from, m.to, mark('cm-def cm-hmd-frontmatter'));
    return false;
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        syntaxTree(update.state) !== syntaxTree(update.startState) ||
        update.state.facet(livePreviewEnabled) !== update.startState.facet(livePreviewEnabled) ||
        update.state.facet(widgetContext) !== update.startState.facet(widgetContext)
      ) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView): DecorationSet {
      const b = new Builder(view);
      for (const { from, to } of view.visibleRanges) b.build(from, to);
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);
