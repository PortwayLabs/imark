import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from '../../src/webview/render/themeHealth';

describe('theme health colour helpers', () => {
  it('parses computed colours', () => {
    expect(parseColor('rgb(12, 34, 56)')).toEqual([12, 34, 56, 1]);
    expect(parseColor('rgba(0, 0, 0, 0.5)')).toEqual([0, 0, 0, 0.5]);
    expect(parseColor('rgb(1 2 3 / 40%)')).toEqual([1, 2, 3, 0.4]);
    expect(parseColor('transparent')).toBeNull();
  });
  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 0);
    expect(contrastRatio([30, 30, 30, 1], [30, 30, 30, 1])).toBe(1);
  });
});
