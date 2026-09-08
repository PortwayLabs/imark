import { describe, expect, it } from 'vitest';
import { parser as baseParser, GFM } from '@lezer/markdown';
import { obsidianSyntax } from '../../src/webview/markdown/obsidianSyntax';

const parser = baseParser.configure([GFM, obsidianSyntax]);

function names(src: string): string[] {
  const tree = parser.parse(src);
  const out: string[] = [];
  tree.iterate({
    enter(n) {
      out.push(`${n.name}:${src.slice(n.from, n.to)}`);
    },
  });
  return out;
}

describe('obsidian syntax extensions', () => {
  it('parses highlights', () => {
    expect(names('a ==hi== b')).toContain('Highlight:==hi==');
  });
  it('parses wikilinks with alias', () => {
    const n = names('see [[Note Name#Heading|alias]] now');
    expect(n).toContain('WikiLink:[[Note Name#Heading|alias]]');
    expect(n).toContain('WikiLinkTarget:Note Name#Heading');
    expect(n).toContain('WikiLinkAlias:alias');
    expect(n.some((x) => x.startsWith('Link:'))).toBe(false);
  });
  it('parses embeds', () => {
    const n = names('![[img.png|300]]');
    expect(n).toContain('Embed:![[img.png|300]]');
    expect(n).toContain('WikiLinkTarget:img.png');
  });
  it('parses tags but not numbers or headings', () => {
    expect(names('a #tag/子标签 b')).toContain('Tag:#tag/子标签');
    expect(names('a #123 b').some((x) => x.startsWith('Tag:'))).toBe(false);
    expect(names('# Title').some((x) => x.startsWith('Tag:'))).toBe(false);
    expect(names('C# is fine').some((x) => x.startsWith('Tag:'))).toBe(false);
  });
  it('parses inline and block math', () => {
    expect(names('cost $5 and $x^2$')).toContain('InlineMath:$x^2$');
    expect(names('$$\nE=mc^2\n$$\n')).toContain('BlockMath:$$\nE=mc^2\n$$');
    expect(names('$$a+b$$\n')).toContain('BlockMath:$$a+b$$');
    expect(names('text $$a$$ more')).toContain('InlineMath:$$a$$');
  });
  it('parses comments', () => {
    expect(names('a %%hidden%% b')).toContain('ObsidianComment:%%hidden%%');
    expect(names('%%\nmulti\nline\n%%\n')).toContain('ObsidianCommentBlock:%%\nmulti\nline\n%%');
  });
  it('parses frontmatter only at document start', () => {
    const n = names('---\ntitle: x\n---\n\n# Hi\n');
    expect(n).toContain('Frontmatter:---\ntitle: x\n---');
    expect(n).toContain('ATXHeading1:# Hi');
    expect(names('text\n\n---\n')).toContain('HorizontalRule:---');
  });
  it('parses footnote refs', () => {
    expect(names('word[^1].')).toContain('FootnoteRef:[^1]');
  });
  it('keeps GFM tables and tasks working', () => {
    const n = names('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(n.some((x) => x.startsWith('Table:'))).toBe(true);
    expect(names('- [ ] todo\n')).toContain('TaskMarker:[ ]');
  });
});
