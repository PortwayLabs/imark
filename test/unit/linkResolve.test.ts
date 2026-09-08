import { describe, expect, it } from 'vitest';
import { FileLookup, parseTarget } from '../../src/shared/linkResolve';

const files = [
  { root: 0, path: 'Notes/Alpha.md' },
  { root: 0, path: 'Notes/sub/Beta.md' },
  { root: 0, path: 'Other/Beta.md' },
  { root: 0, path: 'attachments/pic.png' },
  { root: 0, path: 'Notes/local.png' },
];
const lookup = new FileLookup(files);

describe('parseTarget', () => {
  it('splits alias, heading, block and size', () => {
    expect(parseTarget('Note#Head|Alias')).toMatchObject({ path: 'Note', heading: 'Head', alias: 'Alias' });
    expect(parseTarget('Note#^abc')).toMatchObject({ path: 'Note', block: 'abc' });
    expect(parseTarget('img.png|300x200')).toMatchObject({ path: 'img.png', width: 300, height: 200, alias: null });
    expect(parseTarget('img.png|300')).toMatchObject({ width: 300, height: null });
  });
});

describe('FileLookup.resolve', () => {
  it('resolves by basename', () => {
    expect(lookup.resolve('Alpha', 0, 'Notes/Alpha.md')?.path).toBe('Notes/Alpha.md');
    expect(lookup.resolve('alpha.md', 0, 'x.md')?.path).toBe('Notes/Alpha.md');
  });
  it('prefers shortest path on ambiguity and respects folder hints', () => {
    expect(lookup.resolve('Beta', 0, 'x.md')?.path).toBe('Other/Beta.md');
    expect(lookup.resolve('sub/Beta', 0, 'x.md')?.path).toBe('Notes/sub/Beta.md');
    expect(lookup.resolve('Notes/sub/Beta', 0, 'x.md')?.path).toBe('Notes/sub/Beta.md');
  });
  it('resolves relative to the document folder first', () => {
    expect(lookup.resolve('local.png', 0, 'Notes/Alpha.md')?.path).toBe('Notes/local.png');
    expect(lookup.resolve('pic.png', 0, 'Notes/Alpha.md')?.path).toBe('attachments/pic.png');
  });
  it('returns null for unknown targets', () => {
    expect(lookup.resolve('Nope', 0, 'x.md')).toBeNull();
  });
});
