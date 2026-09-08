// `[[` autocompletion for notes and attachments, like Obsidian.
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { LinkResolver } from '../links';

export function wikilinkCompletion(getResolver: () => LinkResolver | null): Extension {
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const resolver = getResolver();
    if (!resolver) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    const m = /(!?)\[\[([^\[\]|#]*)$/.exec(before);
    if (!m) return null;
    const from = ctx.pos - m[2].length;
    const items = resolver.completionItems();
    const options: Completion[] = items.map((it) => ({
      label: it.label,
      detail: it.isNote ? '' : it.detail,
      type: it.isNote ? 'text' : 'variable',
      apply: (view, _c, f, t) => {
        const after = view.state.doc.sliceString(t, t + 2);
        const closes = after === ']]';
        view.dispatch({
          changes: { from: f, to: t, insert: it.label + (closes ? '' : ']]') },
          selection: { anchor: f + it.label.length + 2 },
        });
      },
    }));
    return { from, options, validFor: /^[^\[\]|#]*$/ };
  };
  return autocompletion({ override: [source], icons: false, activateOnTyping: true, maxRenderedOptions: 50 });
}
