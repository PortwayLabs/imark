// Adds Obsidian's `cm-active` class to lines containing a selection head.
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

const activeLine = Decoration.line({ class: 'cm-active' });

export const activeLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) this.decorations = this.build(update.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      const seen = new Set<number>();
      const lines: number[] = [];
      for (const r of view.state.selection.ranges) {
        const from = view.state.doc.lineAt(r.head).from;
        if (!seen.has(from)) {
          seen.add(from);
          lines.push(from);
        }
      }
      lines.sort((a, b) => a - b);
      for (const from of lines) builder.add(from, from, activeLine);
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations },
);
