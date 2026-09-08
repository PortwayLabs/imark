import { describe, expect, it } from 'vitest';
import { deleteColumn, deleteRow, displayWidth, insertColumn, insertRow, parseTable, sanitizeCell, serializeTable, setAlign, splitRow } from '../../src/webview/editor/tableModel';

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
