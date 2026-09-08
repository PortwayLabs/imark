// Block-level replacements (tables, callouts, display math, HTML blocks,
// frontmatter, block comments) rendered as widgets when the cursor is outside.
// Provided through a StateField because they change the vertical layout.
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { StateField, type EditorState, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { CalloutWidget, HtmlBlockWidget, MathWidget, MermaidWidget, TableWidget, widgetContext, type TableCellInfo, type TableInfo } from './widgets';
import { StateEffect } from '@codemirror/state';
import { mermaidThemeKey } from '../render/mermaid';
import { livePreviewEnabled, selectionTouches } from './livePreview';
import { parseCalloutHeader } from '../render/callouts';
import { renderMarkdown } from '../render/markdownIt';

const containers = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

function tableInfo(state: EditorState, node: SyntaxNode): TableInfo | null {
  const doc = state.doc;
  const header = node.getChild('TableHeader');
  if (!header) return null;
  const cells = (row: SyntaxNode): TableCellInfo[] =>
    row.getChildren('TableCell').map((c) => ({ text: doc.sliceString(c.from, c.to), from: c.from }));
  const headerCells = cells(header);
  const delim = node.getChild('TableDelimiter');
  let aligns: (string | null)[] = [];
  if (delim) {
    const line = doc.lineAt(delim.from).text;
    aligns = line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((s) => {
        const t = s.trim();
        if (t.startsWith(':') && t.endsWith(':')) return 'center';
        if (t.endsWith(':')) return 'right';
        if (t.startsWith(':')) return 'left';
        return null;
      });
  }
  const rows = node.getChildren('TableRow').map((r) => {
    const cs = cells(r);
    while (cs.length < headerCells.length) cs.push({ text: '', from: r.to });
    return cs.slice(0, headerCells.length);
  });
  return { header: headerCells, aligns, rows, source: doc.sliceString(node.from, node.to) };
}

function build(state: EditorState): DecorationSet {
  if (!state.facet(livePreviewEnabled)) return Decoration.none;
  const ctx = state.facet(widgetContext);
  if (!ctx) return Decoration.none;
  const doc = state.doc;
  const decos: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  const blockRange = (node: SyntaxNode) => {
    const from = doc.lineAt(node.from).from;
    const to = doc.lineAt(node.to).to;
    return { from, to };
  };

  tree.iterate({
    enter(n) {
      switch (n.name) {
        case 'Table': {
          const { from, to } = blockRange(n.node);
          if (selectionTouches(state, from, to)) return false;
          const info = tableInfo(state, n.node);
          if (info) decos.push(Decoration.replace({ widget: new TableWidget(info, from), block: true }).range(from, to));
          return false;
        }
        case 'Blockquote': {
          const { from, to } = blockRange(n.node);
          const firstLine = doc.lineAt(n.from).text;
          const header = parseCalloutHeader(firstLine.replace(/^\s*(?:>\s?)+/, ''));
          if (!header) return true; // plain quote: descend for nested tables etc.
          if (selectionTouches(state, from, to)) return true;
          const startLine = doc.lineAt(n.from);
          const endLine = doc.lineAt(n.to);
          const bodyLines: string[] = [];
          for (let i = startLine.number + 1; i <= endLine.number; i++) {
            bodyLines.push(doc.line(i).text.replace(/^\s*>\s?/, ''));
          }
          decos.push(
            Decoration.replace({
              widget: new CalloutWidget(header, bodyLines.join('\n'), doc.sliceString(from, to)),
              block: true,
            }).range(from, to),
          );
          return false;
        }
        case 'BlockMath': {
          const { from, to } = blockRange(n.node);
          if (selectionTouches(state, from, to)) return false;
          const marks = n.node.getChildren('MathMark');
          const tex = marks.length === 2 ? doc.sliceString(marks[0].to, marks[1].from) : doc.sliceString(n.from + 2, n.to);
          decos.push(Decoration.replace({ widget: new MathWidget(tex, true, true), block: true }).range(from, to));
          return false;
        }
        case 'HTMLBlock': {
          const { from, to } = blockRange(n.node);
          if (selectionTouches(state, from, to)) return false;
          const html = doc.sliceString(n.from, n.to);
          if (/^\s*<!--/.test(html)) {
            decos.push(Decoration.replace({ block: true }).range(from, to));
          } else {
            decos.push(Decoration.replace({ widget: new HtmlBlockWidget(html), block: true }).range(from, to));
          }
          return false;
        }
        case 'ObsidianCommentBlock': {
          const { from, to } = blockRange(n.node);
          if (selectionTouches(state, from, to)) return false;
          decos.push(Decoration.replace({ block: true }).range(from, to));
          return false;
        }
        case 'FencedCode': {
          const info = n.node.getChild('CodeInfo');
          const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0].toLowerCase() : '';
          if (lang !== 'mermaid') return false;
          const { from, to } = blockRange(n.node);
          if (selectionTouches(state, from, to)) return false;
          const marks = n.node.getChildren('CodeMark');
          const startLine = doc.lineAt(n.from);
          const codeFrom = Math.min(startLine.to + 1, to);
          const codeTo = marks.length > 1 ? Math.max(codeFrom, doc.lineAt(marks[1].from).from - 1) : to;
          const code = doc.sliceString(codeFrom, Math.max(codeFrom, codeTo));
          decos.push(Decoration.replace({ widget: new MermaidWidget(code, mermaidThemeKey()), block: true }).range(from, to));
          return false;
        }
        case 'Frontmatter': {
          const { from, to } = blockRange(n.node);
          // A cursor sitting at the very start of the document should still see the properties widget.
          if (selectionTouches(state, from + 1, to)) return false;
          const html = renderMarkdown(doc.sliceString(n.from, n.to) + '\n', { resolver: ctx.resolver, depth: 1 });
          decos.push(Decoration.replace({ widget: new HtmlBlockWidget(html, 'cm-embed-block imark-frontmatter-widget', 4), block: true }).range(from, to));
          return false;
        }
        default:
          return containers.has(n.name);
      }
    },
  });
  return Decoration.set(decos, true);
}

/** Forces block widgets to be rebuilt (e.g. after the light/dark theme changed). */
export const rebuildBlockWidgets = StateEffect.define<null>();

export const blockWidgetsField = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    if (
      tr.effects.some((e) => e.is(rebuildBlockWidgets)) ||
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
      tr.state.facet(livePreviewEnabled) !== tr.startState.facet(livePreviewEnabled) ||
      tr.state.facet(widgetContext) !== tr.startState.facet(widgetContext)
    ) {
      return build(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
