import { describe, expect, it } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { setHeading, toggleBold, toggleBulletList, toggleCheckbox, toggleTaskList } from '../../src/webview/editor/commands';

function run(cmd: (t: { state: EditorState; dispatch: (tr: import('@codemirror/state').Transaction) => void }) => boolean, doc: string, anchor: number, head = anchor) {
  let state = EditorState.create({ doc, selection: EditorSelection.single(anchor, head) });
  const ok = cmd({ state, dispatch: (tr) => (state = tr.state) });
  return { ok, doc: state.doc.toString(), sel: state.selection.main };
}

describe('editing commands', () => {
  it('wraps a selection in bold and unwraps it again', () => {
    const r1 = run(toggleBold, 'hello world', 0, 5);
    expect(r1.doc).toBe('**hello** world');
    const r2 = run(toggleBold, r1.doc, r1.sel.from, r1.sel.to);
    expect(r2.doc).toBe('hello world');
  });
  it('bolds the word at the cursor', () => {
    expect(run(toggleBold, 'hello world', 2).doc).toBe('**hello** world');
  });
  it('inserts empty markers when not on a word', () => {
    const r = run(toggleBold, 'a  b', 2);
    expect(r.doc).toBe('a **** b');
    expect(r.sel.head).toBe(4);
  });
  it('sets and clears heading levels', () => {
    expect(run(setHeading(2), 'Title', 0).doc).toBe('## Title');
    expect(run(setHeading(3), '## Title', 0).doc).toBe('### Title');
    expect(run(setHeading(0), '## Title', 0).doc).toBe('Title');
  });
  it('toggles bullet lists over multiple lines', () => {
    const r = run(toggleBulletList, 'a\nb', 0, 3);
    expect(r.doc).toBe('- a\n- b');
    expect(run(toggleBulletList, r.doc, 0, r.doc.length).doc).toBe('a\nb');
  });
  it('toggles task lists and checkboxes', () => {
    expect(run(toggleTaskList, 'a', 0).doc).toBe('- [ ] a');
    expect(run(toggleCheckbox, '- [ ] a', 0).doc).toBe('- [x] a');
    expect(run(toggleCheckbox, '- [x] a', 0).doc).toBe('- [ ] a');
    expect(run(toggleCheckbox, '- a', 0).doc).toBe('- [ ] a');
    expect(run(toggleCheckbox, 'plain', 0).ok).toBe(false);
  });
});
