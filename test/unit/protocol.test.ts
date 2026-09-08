import { describe, expect, it } from 'vitest';
import { applyChanges, diffChange, normalizeEol } from '../../src/shared/protocol';

describe('protocol helpers', () => {
  it('applies sorted changes', () => {
    expect(applyChanges('hello world', [{ from: 0, to: 5, insert: 'goodbye' }, { from: 6, to: 11, insert: 'moon' }])).toBe('goodbye moon');
    expect(applyChanges('abc', [{ from: 1, to: 1, insert: 'X' }])).toBe('aXbc');
    expect(applyChanges('abc', [{ from: 3, to: 3, insert: '\n' }])).toBe('abc\n');
  });
  it('rejects unsorted changes', () => {
    expect(() => applyChanges('abc', [{ from: 2, to: 2, insert: 'x' }, { from: 1, to: 1, insert: 'y' }])).toThrow();
  });
  it('diffs to a single minimal change', () => {
    expect(diffChange('abc', 'abc')).toBeNull();
    expect(diffChange('hello world', 'hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' });
    expect(diffChange('aaa', 'a')).toEqual({ from: 1, to: 3, insert: '' });
    const a = 'line1\nline2\nline3';
    const b = 'line1\nLINE2\nline3';
    const c = diffChange(a, b)!;
    expect(applyChanges(a, [c])).toBe(b);
  });
  it('normalizes EOLs', () => {
    expect(normalizeEol('a\r\nb\rc\n')).toBe('a\nb\nc\n');
  });
});
