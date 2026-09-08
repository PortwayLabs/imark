// Markdown editing commands (Typora / Obsidian style shortcuts).
import { EditorSelection, type ChangeSpec, type EditorState, type StateCommand } from '@codemirror/state';
import { indentLess, indentMore, insertTab } from '@codemirror/commands';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';

type Cmd = (view: EditorView) => boolean;

const wordChar = /[\p{L}\p{N}_]/u;

/** Toggle inline markup around each selection range (or the word at the cursor). */
export function toggleInline(open: string, close = open): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      let { from, to } = range;
      const doc = state.doc;
      if (from === to) {
        // Expand to the word at the cursor.
        let s = from;
        let e = to;
        while (s > 0 && wordChar.test(doc.sliceString(s - 1, s))) s--;
        while (e < doc.length && wordChar.test(doc.sliceString(e, e + 1))) e++;
        if (s === e) {
          // Empty: insert markers and place cursor between.
          const outerBefore = doc.sliceString(Math.max(0, from - open.length), from);
          const outerAfter = doc.sliceString(to, to + close.length);
          if (outerBefore === open && outerAfter === close) {
            return {
              changes: [
                { from: from - open.length, to: from },
                { from: to, to: to + close.length },
              ],
              range: EditorSelection.cursor(from - open.length),
            };
          }
          return {
            changes: { from, insert: open + close },
            range: EditorSelection.cursor(from + open.length),
          };
        }
        from = s;
        to = e;
      }
      const before = doc.sliceString(Math.max(0, from - open.length), from);
      const after = doc.sliceString(to, to + close.length);
      const selected = doc.sliceString(from, to);
      if (before === open && after === close) {
        return {
          changes: [
            { from: from - open.length, to: from },
            { from: to, to: to + close.length },
          ],
          range: EditorSelection.range(from - open.length, to - open.length),
        };
      }
      if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
        return {
          changes: [
            { from, to: from + open.length },
            { from: to - close.length, to },
          ],
          range: EditorSelection.range(from, to - open.length - close.length),
        };
      }
      return {
        changes: [
          { from, insert: open },
          { from: to, insert: close },
        ],
        range: EditorSelection.range(from + open.length, to + open.length),
      };
    });
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input.format' }));
    return true;
  };
}

export const toggleBold = toggleInline('**');
export const toggleItalic = toggleInline('*');
export const toggleStrikethrough = toggleInline('~~');
export const toggleHighlight = toggleInline('==');
export const toggleInlineCode = toggleInline('`');
export const toggleInlineMath = toggleInline('$');

function selectedLines(state: EditorState) {
  const lines = new Map<number, { from: number; to: number; text: string }>();
  for (const r of state.selection.ranges) {
    const start = state.doc.lineAt(r.from).number;
    const end = state.doc.lineAt(r.to === r.from ? r.to : Math.max(r.from, r.to - 1)).number;
    for (let n = start; n <= end; n++) {
      const l = state.doc.line(n);
      lines.set(n, { from: l.from, to: l.to, text: l.text });
    }
  }
  return [...lines.values()];
}

/** Set (or remove, with level 0) the ATX heading level of the selected lines. */
export function setHeading(level: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes: ChangeSpec[] = [];
    for (const line of selectedLines(state)) {
      const m = /^(\s{0,3})(#{1,6}\s+)?/.exec(line.text)!;
      const prefix = level > 0 ? '#'.repeat(level) + ' ' : '';
      changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: prefix });
    }
    dispatch(state.update({ changes, userEvent: 'input.format' }));
    return true;
  };
}

const listRe = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;
const quoteRe = /^(\s*)>\s?/;

function toggleLinePrefix(kind: 'ul' | 'ol' | 'task' | 'quote'): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state);
    const changes: ChangeSpec[] = [];
    if (kind === 'quote') {
      const allQuoted = lines.every((l) => quoteRe.test(l.text) || l.text.trim() === '');
      for (const l of lines) {
        if (allQuoted) {
          const m = quoteRe.exec(l.text);
          if (m) changes.push({ from: l.from + m[1].length, to: l.from + m[0].length });
        } else {
          changes.push({ from: l.from, insert: '> ' });
        }
      }
    } else {
      const matches = lines.map((l) => listRe.exec(l.text));
      const isKind = (m: RegExpExecArray | null) =>
        !!m && (kind === 'task' ? !!m[3] : kind === 'ol' ? /\d/.test(m[2]) && !m[3] : /[-*+]/.test(m[2]) && !m[3]);
      const allKind = lines.every((l, i) => isKind(matches[i]) || l.text.trim() === '');
      let n = 1;
      lines.forEach((l, i) => {
        const m = matches[i];
        if (allKind) {
          if (m) changes.push({ from: l.from + m[1].length, to: l.from + m[0].length });
          return;
        }
        const indent = m ? m[1] : /^\s*/.exec(l.text)![0];
        const marker = kind === 'ol' ? `${n++}. ` : kind === 'task' ? '- [ ] ' : '- ';
        const start = l.from + indent.length;
        const end = m ? l.from + m[0].length : start;
        changes.push({ from: start, to: end, insert: marker });
      });
    }
    dispatch(state.update({ changes, userEvent: 'input.format' }));
    return true;
  };
}

export const toggleBulletList = toggleLinePrefix('ul');
export const toggleOrderedList = toggleLinePrefix('ol');
export const toggleTaskList = toggleLinePrefix('task');
export const toggleBlockquote = toggleLinePrefix('quote');

/** Toggle `[ ]`/`[x]` on task lines; turn plain list items into tasks. */
export const toggleCheckbox: StateCommand = ({ state, dispatch }) => {
  const changes: ChangeSpec[] = [];
  for (const l of selectedLines(state)) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(\[([ xX])\]\s)?/.exec(l.text);
    if (!m) continue;
    if (m[3]) {
      const boxPos = l.from + m[0].length - m[3].length + 1;
      changes.push({ from: boxPos, to: boxPos + 1, insert: m[4] === ' ' ? 'x' : ' ' });
    } else {
      changes.push({ from: l.from + m[0].length, insert: '[ ] ' });
    }
  }
  if (!changes.length) return false;
  dispatch(state.update({ changes, userEvent: 'input.format' }));
  return true;
};

const urlRe = /^(https?:\/\/|mailto:|www\.)\S+$/i;

export const insertLink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    if (urlRe.test(text)) {
      return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) };
    }
    const insert = `[${text}]()`;
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.cursor(range.from + insert.length - 1),
    };
  });
  dispatch(state.update(changes, { userEvent: 'input.format' }));
  return true;
};

export const insertWikilink: StateCommand = ({ state, dispatch }) => {
  const changes = state.changeByRange((range) => {
    const text = state.doc.sliceString(range.from, range.to);
    return {
      changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
      range: EditorSelection.cursor(range.from + 2 + text.length),
    };
  });
  dispatch(state.update(changes, { userEvent: 'input.format' }));
  return true;
};

function insertBlock(template: string, cursorOffset: number): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const line = state.doc.lineAt(range.from);
      const prefix = line.text.trim() === '' ? '' : '\n';
      const suffix = range.to === state.doc.length || state.doc.lineAt(range.to).text.trim() === '' ? '' : '\n';
      const insert = prefix + template + suffix;
      const at = range.from;
      return {
        changes: { from: at, to: range.to, insert },
        range: EditorSelection.cursor(at + prefix.length + cursorOffset),
      };
    });
    dispatch(state.update(changes, { userEvent: 'input.format', scrollIntoView: true }));
    return true;
  };
}

export const insertCodeBlock = insertBlock('```\n\n```', 3);
export const insertMathBlock = insertBlock('$$\n\n$$', 3);
export const insertTable = insertBlock('| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |', 2);
export const insertHorizontalRule = insertBlock('---', 3);
export const insertCallout = insertBlock('> [!note] Title\n> ', 19);

function isListLine(state: EditorState, pos: number): boolean {
  return listRe.test(state.doc.lineAt(pos).text);
}

/** Tab: indent list items; otherwise insert a tab/spaces. */
export const smartIndent: Cmd = (view) => {
  const { state } = view;
  if (state.selection.ranges.every((r) => isListLine(state, r.from))) return indentMore(view);
  return insertTab(view);
};

export const smartOutdent: Cmd = (view) => indentLess(view);

/** Toggle the `data-task` mark on Enter in an empty task line etc. is handled by lang-markdown. */

export interface LinkAtCursor {
  kind: 'url' | 'wikilink' | 'tag';
  target: string;
}

export function linkAtCursor(state: EditorState): LinkAtCursor | null {
  const pos = state.selection.main.head;
  const tree = syntaxTree(state);
  let node = tree.resolveInner(pos, -1);
  while (node.parent && !/^(Link|Image|WikiLink|Embed|Autolink|URL|Tag)$/.test(node.name)) node = node.parent;
  if (/^(WikiLink|Embed)$/.test(node.name)) {
    const target = node.getChild('WikiLinkTarget');
    if (target) return { kind: 'wikilink', target: state.doc.sliceString(target.from, target.to) };
    return null;
  }
  if (node.name === 'Link' || node.name === 'Image') {
    const url = node.getChild('URL');
    if (url) return { kind: 'url', target: state.doc.sliceString(url.from, url.to) };
    return null;
  }
  if (node.name === 'Autolink' || node.name === 'URL') {
    return { kind: 'url', target: state.doc.sliceString(node.from, node.to).replace(/^<|>$/g, '') };
  }
  if (node.name === 'Tag') return { kind: 'tag', target: state.doc.sliceString(node.from + 1, node.to) };
  return null;
}
