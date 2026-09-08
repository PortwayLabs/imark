import type { KeyBinding } from '@codemirror/view';
import { redo, undo } from '@codemirror/commands';
import {
  insertCallout,
  insertCodeBlock,
  insertHorizontalRule,
  insertLink,
  insertMathBlock,
  insertTable,
  insertWikilink,
  setHeading,
  smartIndent,
  smartOutdent,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleCheckbox,
  toggleHighlight,
  toggleInlineCode,
  toggleItalic,
  toggleOrderedList,
  toggleStrikethrough,
  toggleTaskList,
} from './commands';

export interface KeymapActions {
  toggleReading(): void;
  toggleSource(): void;
  followLink(): boolean;
}

export function buildKeymap(actions: KeymapActions): KeyBinding[] {
  return [
    { key: 'Mod-b', run: toggleBold, preventDefault: true },
    { key: 'Mod-i', run: toggleItalic, preventDefault: true },
    { key: 'Mod-`', run: toggleInlineCode, preventDefault: true },
    { key: 'Mod-Shift-h', run: toggleHighlight, preventDefault: true },
    { key: 'Alt-Shift-5', run: toggleStrikethrough, preventDefault: true },
    { key: 'Mod-Shift-x', run: toggleStrikethrough, preventDefault: true },
    { key: 'Mod-k', run: insertLink, preventDefault: true },
    { key: 'Mod-Shift-k', run: insertWikilink, preventDefault: true },
    { key: 'Mod-e', run: () => (actions.toggleReading(), true), preventDefault: true },
    { key: 'Mod-/', run: () => (actions.toggleSource(), true), preventDefault: true },
    { key: 'Mod-Enter', run: (view) => toggleCheckbox(view) || actions.followLink(), preventDefault: true },
    { key: 'Alt-Enter', run: () => actions.followLink(), preventDefault: true },
    { key: 'Mod-0', run: setHeading(0), preventDefault: true },
    { key: 'Mod-1', run: setHeading(1), preventDefault: true },
    { key: 'Mod-2', run: setHeading(2), preventDefault: true },
    { key: 'Mod-3', run: setHeading(3), preventDefault: true },
    { key: 'Mod-4', run: setHeading(4), preventDefault: true },
    { key: 'Mod-5', run: setHeading(5), preventDefault: true },
    { key: 'Mod-6', run: setHeading(6), preventDefault: true },
    { key: 'Mod-Alt-u', run: toggleBulletList, preventDefault: true },
    { key: 'Mod-Alt-o', run: toggleOrderedList, preventDefault: true },
    { key: 'Mod-Alt-x', run: toggleTaskList, preventDefault: true },
    { key: 'Mod-Alt-q', run: toggleBlockquote, preventDefault: true },
    { key: 'Mod-Alt-c', run: insertCodeBlock, preventDefault: true },
    { key: 'Mod-Alt-t', run: insertTable, preventDefault: true },
    { key: 'Mod-Alt-m', run: insertMathBlock, preventDefault: true },
    { key: 'Mod-Alt--', run: insertHorizontalRule, preventDefault: true },
    { key: 'Mod-Alt-n', run: insertCallout, preventDefault: true },
    { key: 'Tab', run: smartIndent, shift: smartOutdent, preventDefault: true },
    { key: 'Mod-z', run: undo, preventDefault: true },
    { key: 'Mod-Shift-z', run: redo, preventDefault: true },
    { key: 'Mod-y', run: redo, preventDefault: true },
  ];
}
