// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../src/webview/render/markdownIt';
import { LinkResolver } from '../../src/webview/links';

const resolver = new LinkResolver(
  [{ fsPath: '/vault', webviewUri: 'https://res/vault' }],
  { fsPath: '/vault/notes/doc.md', title: 'doc', root: 0, path: 'notes/doc.md' },
  [
    { root: 0, path: 'notes/Other.md' },
    { root: 0, path: 'img/pic.png' },
  ],
);
const ctx = { resolver };

describe('renderMarkdown (Obsidian flavoured)', () => {
  it('renders callouts with Obsidian DOM', () => {
    const html = renderMarkdown('> [!tip] Title\n> body **bold**\n', ctx);
    expect(html).toContain('class="callout"');
    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('callout-title-inner');
    expect(html).toContain('<strong>bold</strong>');
  });
  it('renders task lists with checkboxes carrying source lines', () => {
    const html = renderMarkdown('- [ ] a\n- [x] b\n', ctx);
    expect(html).toContain('task-list-item-checkbox');
    expect(html).toContain('data-line="1"');
    expect(html).toContain('is-checked');
    expect(html).toContain('contains-task-list');
  });
  it('renders wikilinks, embeds and tags', () => {
    const html = renderMarkdown('[[Other|alias]] [[Nope]] ![[pic.png|100]] #tag', ctx);
    expect(html).toContain('class="internal-link"');
    expect(html).toContain('>alias</a>');
    expect(html).toContain('is-unresolved');
    expect(html).toContain('https://res/vault/img/pic.png');
    expect(html).toContain('width="100"');
    expect(html).toContain('class="tag"');
  });
  it('renders math and highlights and strips comments', () => {
    const html = renderMarkdown('a ==hi== $x^2$ %%secret%%\n\n$$\ny\n$$\n', ctx);
    expect(html).toContain('<mark>hi</mark>');
    expect(html).toContain('math-inline');
    expect(html).toContain('math-block');
    expect(html).not.toContain('secret');
  });
  it('renders frontmatter as properties and wraps blocks', () => {
    const html = renderMarkdown('---\ntitle: X\ntags: [a, b]\n---\n\n# H\n\ntext', ctx);
    expect(html).toContain('metadata-container');
    expect(html).toContain('multi-select-pill');
    expect(html).toContain('class="el-h1"');
    expect(html).toContain('data-heading="H"');
  });
  it('sanitizes scripts', () => {
    const html = renderMarkdown('<script>alert(1)</script><b onclick="x()">ok</b>', ctx);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<b>ok</b>');
  });
  it('resolves relative image paths against the document', () => {
    const html = renderMarkdown('![alt|50](../img/pic.png)', ctx);
    expect(html).toContain('src="https://res/vault/img/pic.png"');
    expect(html).toContain('width="50"');
  });
});
