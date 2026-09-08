// Assembles the CodeMirror 6 editor with Markdown language support, live
// preview decorations, Obsidian-style keymaps and widgets.
import { EditorState, Compartment, type Extension, Annotation } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { indentUnit, syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import type { EditorConfig } from '../../shared/protocol';
import { obsidianSyntax } from '../markdown/obsidianSyntax';
import { livePreviewPlugin, livePreviewEnabled, editorConfigFacet, selectionTouches } from './livePreview';
import { blockWidgetsField, rebuildBlockWidgets } from './blockWidgets';
import { activeLinePlugin } from './activeLine';
import { widgetContext, type WidgetContext } from './widgets';
import { buildKeymap, type KeymapActions } from './keymap';
import { wikilinkCompletion } from './wikilinkComplete';
import { imagePaste } from './paste';
import { linkAtCursor } from './commands';
import type { LinkResolver } from '../links';

/** Marks transactions that mirror external document changes (not echoed back). */
export const externalChange = Annotation.define<boolean>();

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  config: EditorConfig;
  title: string;
  live: boolean;
  widgetCtx: WidgetContext;
  getResolver(): LinkResolver | null;
  actions: KeymapActions;
  onUpdate(update: ViewUpdate): void;
  openLink(kind: 'url' | 'wikilink' | 'tag', target: string): void;
}

export interface EditorHandle {
  view: EditorView;
  setLive(live: boolean): void;
  setConfig(config: EditorConfig): void;
  setTitle(title: string): void;
  setWidgetContext(ctx: WidgetContext): void;
  /** Rebuild block widgets (diagrams re-render for a new light/dark theme). */
  refreshWidgets(): void;
}

const markdownPairs = ['(', '[', '{', "'", '"', '`', '*', '_', '~', '=', '$', '<'];
const plainPairs = ['(', '[', '{', "'", '"'];

function linkClickHandler(opts: EditorOptions): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
      if (pos == null) return false;
      const target = event.target as HTMLElement;
      if (!target.closest('.cm-link, .cm-hmd-internal-link, .cm-url, .cm-hashtag')) return false;
      const tree = syntaxTree(view.state);
      let node = tree.resolveInner(pos, 1);
      while (node.parent && !/^(Link|WikiLink|Autolink|URL|Tag)$/.test(node.name)) node = node.parent;
      if (!/^(Link|WikiLink|Autolink|URL|Tag)$/.test(node.name)) return false;
      const cfg = view.state.facet(editorConfigFacet);
      const live = view.state.facet(livePreviewEnabled);
      const mod = event.metaKey || event.ctrlKey;
      const hidden = live && !selectionTouches(view.state, node.from, node.to);
      if (!mod && !(cfg?.smartClickLinks !== false && hidden)) return false;
      const doc = view.state.doc;
      if (node.name === 'WikiLink') {
        const t = node.getChild('WikiLinkTarget');
        if (!t) return false;
        event.preventDefault();
        opts.openLink('wikilink', doc.sliceString(t.from, t.to));
        return true;
      }
      if (node.name === 'Tag') {
        event.preventDefault();
        opts.openLink('tag', doc.sliceString(node.from + 1, node.to));
        return true;
      }
      if (node.name === 'Link') {
        const url = node.getChild('URL');
        if (!url) return false;
        // Only the visible text part (or anywhere with a modifier).
        event.preventDefault();
        opts.openLink('url', doc.sliceString(url.from, url.to));
        return true;
      }
      event.preventDefault();
      opts.openLink('url', doc.sliceString(node.from, node.to).replace(/^<|>$/g, ''));
      return true;
    },
  });
}

export function createEditor(opts: EditorOptions): EditorHandle {
  const liveComp = new Compartment();
  const configComp = new Compartment();
  const pairsComp = new Compartment();
  const attrsComp = new Compartment();
  const indentComp = new Compartment();
  const widgetComp = new Compartment();

  const configExtensions = (cfg: EditorConfig): Record<string, Extension> => ({
    config: editorConfigFacet.of(cfg),
    pairs: markdownLanguage.data.of({ closeBrackets: { brackets: cfg.autoPairMarkdown ? markdownPairs : plainPairs } }),
    attrs: EditorView.contentAttributes.of({
      spellcheck: cfg.spellcheck ? 'true' : 'false',
      autocorrect: cfg.spellcheck ? 'on' : 'off',
      autocapitalize: 'off',
      'aria-label': 'Markdown editor',
    }),
    indent: [indentUnit.of(cfg.insertSpaces ? ' '.repeat(cfg.tabSize) : '\t'), EditorState.tabSize.of(cfg.tabSize)],
  });

  let current = configExtensions(opts.config);

  const actions: KeymapActions = {
    ...opts.actions,
    followLink: () => {
      const info = linkAtCursor(view.state);
      if (!info) return false;
      opts.openLink(info.kind, info.target);
      return true;
    },
  };

  const state = EditorState.create({
    doc: opts.doc,
    extensions: [
      liveComp.of(livePreviewEnabled.of(opts.live)),
      configComp.of(current.config),
      widgetComp.of(widgetContext.of(opts.widgetCtx)),
      markdown({ base: markdownLanguage, codeLanguages: languages, extensions: obsidianSyntax, addKeymap: true }),
      pairsComp.of(current.pairs),
      // Gutters must exist from the start: CodeMirror inserts them next to the
      // content DOM, which we move into Obsidian's `.cm-sizer` wrapper below.
      lineNumbers(),
      attrsComp.of(current.attrs),
      indentComp.of(current.indent),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      closeBrackets(),
      search({ top: true }),
      blockWidgetsField,
      livePreviewPlugin,
      activeLinePlugin,
      wikilinkCompletion(opts.getResolver),
      imagePaste(() => view.state.facet(editorConfigFacet)?.attachmentLinkStyle ?? 'markdown'),
      linkClickHandler(opts),
      keymap.of([...buildKeymap(actions), ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
      EditorView.updateListener.of(opts.onUpdate),
    ],
  });

  const view = new EditorView({ state, parent: opts.parent });

  // Reproduce Obsidian's editor DOM: .cm-scroller > [.cm-gutters] .cm-sizer > (.inline-title, .cm-contentContainer > .cm-content)
  const sizer = document.createElement('div');
  sizer.className = 'cm-sizer';
  const container = document.createElement('div');
  container.className = 'cm-contentContainer';
  const inlineTitle = document.createElement('div');
  inlineTitle.className = 'inline-title';
  inlineTitle.setAttribute('contenteditable', 'false');
  inlineTitle.setAttribute('tabindex', '-1');
  inlineTitle.textContent = opts.title;
  inlineTitle.style.display = opts.config.showInlineTitle ? '' : 'none';
  view.scrollDOM.insertBefore(sizer, view.contentDOM);
  sizer.append(inlineTitle, container);
  container.appendChild(view.contentDOM);
  view.requestMeasure();

  const applyConfig = (cfg: EditorConfig) => {
    current = configExtensions(cfg);
    inlineTitle.style.display = cfg.showInlineTitle ? '' : 'none';
    view.dispatch({
      effects: [
        configComp.reconfigure(current.config),
        pairsComp.reconfigure(current.pairs),
        attrsComp.reconfigure(current.attrs),
        indentComp.reconfigure(current.indent),
      ],
    });
  };

  return {
    view,
    setLive(l) {
      view.dispatch({ effects: liveComp.reconfigure(livePreviewEnabled.of(l)) });
    },
    setConfig: applyConfig,
    setTitle(t) {
      inlineTitle.textContent = t;
    },
    setWidgetContext(ctx) {
      view.dispatch({ effects: widgetComp.reconfigure(widgetContext.of(ctx)) });
    },
    refreshWidgets() {
      view.dispatch({ effects: rebuildBlockWidgets.of(null) });
    },
  };
}

