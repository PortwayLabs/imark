import { describe, expect, it } from 'vitest';
import {
  cellToPlain,
  clearRange,
  deleteColumn,
  deleteColumns,
  deleteRow,
  deleteRows,
  displayWidth,
  duplicateRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  normalizeRange,
  parseClipboardGrid,
  parseTable,
  pasteGrid,
  rangeCells,
  rangeToMarkdown,
  rangeToTsv,
  sanitizeCell,
  serializeTable,
  setAlign,
  splitRow,
} from '../../src/webview/editor/tableModel';

const src = ['| 功能 | 状态 | 备注 |', '| :--- | :---: | ---: |', '| Live Preview | ✅ | 类 Typora |', '| 主题 | ✅ | 加载 **Obsidian** 主题 |'].join('\n');

describe('table model', () => {
  it('splits rows honouring escaped pipes and inline code', () => {
    expect(splitRow('| a | b \\| c | `x | y` |')).toEqual(['a', 'b \\| c', '`x | y`']);
    expect(splitRow('a | b')).toEqual(['a', 'b']);
  });
  it('parses a table with alignments and pads short rows', () => {
    const m = parseTable(src + '\n| only one |')!;
    expect(m.header).toEqual(['功能', '状态', '备注']);
    expect(m.aligns).toEqual(['left', 'center', 'right']);
    expect(m.rows.length).toBe(3);
    expect(m.rows[2]).toEqual(['only one', '', '']);
    expect(parseTable('not a table\nreally')).toBeNull();
  });
  it('round-trips through serialize / parse', () => {
    const m = parseTable(src)!;
    const out = serializeTable(m);
    expect(parseTable(out)).toEqual(m);
    expect(out.split('\n')[1]).toMatch(/^\| :-+ \| :-+: \| -+: \|$/);
    // columns are padded to equal display width (CJK counts double)
    const lens = new Set(out.split('\n').map((l) => displayWidth(l)));
    expect(lens.size).toBe(1);
    expect(displayWidth('中a✅')).toBe(5);
  });
  it('sanitizes typed cell text', () => {
    expect(sanitizeCell(' a | b ')).toBe('a \\| b');
    expect(sanitizeCell('line1\nline2')).toBe('line1<br>line2');
    expect(sanitizeCell('ends with backslash\\')).toBe('ends with backslash\\\\');
  });
  it('edits structure immutably', () => {
    const m = parseTable(src)!;
    expect(insertRow(m, 1).rows.length).toBe(3);
    expect(insertRow(m, 1).rows[1]).toEqual(['', '', '']);
    expect(deleteRow(m, 0).rows[0][0]).toBe('主题');
    const withCol = insertColumn(m, 1);
    expect(withCol.header).toEqual(['功能', '', '状态', '备注']);
    expect(withCol.rows[0]).toEqual(['Live Preview', '', '✅', '类 Typora']);
    expect(deleteColumn(withCol, 1)).toEqual(m);
    expect(deleteColumn({ header: ['a'], aligns: [null], rows: [] }, 0).header).toEqual(['a']);
    expect(setAlign(m, 0, 'right').aligns[0]).toBe('right');
    expect(m.rows.length).toBe(2); // original untouched
  });
});

describe('table ranges, copy & paste', () => {
  const m = parseTable(src)!;
  it('copies a range as Markdown, TSV and plain cell text', () => {
    expect(rangeToTsv(m, { r0: 0, c0: 0, r1: 1, c1: 1 })).toBe('Live Preview\t✅\n主题\t✅');
    const md = rangeToMarkdown(m, { r0: 1, c0: 2, r1: 0, c1: 1 });
    // body-only ranges keep the column headers; the range is normalised
    expect(parseTable(md)).toEqual({ header: ['状态', '备注'], aligns: ['center', 'right'], rows: [['✅', '类 Typora'], ['✅', '加载 **Obsidian** 主题']] });
    const withHeader = parseTable(rangeToMarkdown(m, { r0: -1, c0: 0, r1: 0, c1: 0 }))!;
    expect(withHeader.header).toEqual(['功能']);
    expect(withHeader.rows).toEqual([['Live Preview']]);
    expect(cellToPlain('a<br>b \\| c')).toBe('a b | c');
    expect(rangeCells(m, { r0: -1, c0: 1, r1: -1, c1: 2 })).toEqual([['状态', '备注']]);
  });
  it('parses clipboard grids from TSV and Markdown tables only', () => {
    expect(parseClipboardGrid('a\tb\nc\td\n')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseClipboardGrid('x | y\n--|--\n1 | 2')).toEqual([['x', 'y'], ['1', '2']]);
    expect(parseClipboardGrid('just text')).toBeNull();
    expect(parseClipboardGrid('two\nlines')).toBeNull();
    expect(parseClipboardGrid('a|b\tc')).toEqual([['a\\|b', 'c']]);
  });
  it('pastes a grid, growing the table as needed', () => {
    const out = pasteGrid(m, 1, 2, [['p', 'q'], ['r', 's']]);
    expect(out.header).toEqual(['功能', '状态', '备注', '']);
    expect(out.rows[1]).toEqual(['主题', '✅', 'p', 'q']);
    expect(out.rows[2]).toEqual(['', '', 'r', 's']);
    expect(pasteGrid(m, -1, 0, [['H']]).header[0]).toBe('H');
    expect(m.rows.length).toBe(2); // original untouched
  });
  it('clears ranges and deletes row / column spans', () => {
    const cleared = clearRange(m, { r0: -1, c0: 1, r1: 0, c1: 1 });
    expect(cleared.header[1]).toBe('');
    expect(cleared.rows[0][1]).toBe('');
    expect(cleared.rows[1][1]).toBe('✅');
    expect(deleteRows(m, 1, 0).rows).toEqual([]);
    expect(deleteRows(m, -1, 0).rows.length).toBe(1); // the header is never deleted
    expect(deleteColumns(m, 0, 1).header).toEqual(['备注']);
    expect(deleteColumns(m, 0, 2)).toBe(m); // at least one column stays
  });
  it('duplicates and moves rows and columns', () => {
    expect(duplicateRow(m, 0).rows.map((r) => r[0])).toEqual(['Live Preview', 'Live Preview', '主题']);
    expect(moveRow(m, 0, 1).rows[0][0]).toBe('主题');
    const mc = moveColumn(m, 0, 2);
    expect(mc.header).toEqual(['状态', '备注', '功能']);
    expect(mc.aligns).toEqual(['center', 'right', 'left']);
    expect(normalizeRange({ r0: 2, c0: 3, r1: -1, c1: 0 })).toEqual({ r0: -1, c0: 0, r1: 2, c1: 3 });
  });
});
