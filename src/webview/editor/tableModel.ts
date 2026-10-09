// Markdown table model: parse GFM pipe tables into cells and serialize them
// back with aligned columns. Pure functions, unit tested.

export type Align = 'left' | 'center' | 'right' | null;

export interface TableModel {
  header: string[];
  aligns: Align[];
  rows: string[][];
}

/** A rectangular block of cells; `r = -1` is the header row. Bounds are inclusive. */
export interface CellRange {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

/** Split a table row into raw cell strings, honouring `\|` escapes and inline code. */
export function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      cur += ch + text[i + 1];
      i++;
      continue;
    }
    if (ch === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      if (inCode === 0) inCode = run;
      else if (inCode === run) inCode = 0;
      cur += text.slice(i, i + run);
      i += run - 1;
      continue;
    }
    if (ch === '|' && inCode === 0) {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseAlign(cell: string): Align {
  const t = cell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

export function isDelimiterRow(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()));
}

/** Parse the source text of a GFM table. Returns null when it is not a table. */
export function parseTable(source: string): TableModel | null {
  const lines = source.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null;
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map(parseAlign);
  const cols = header.length;
  while (aligns.length < cols) aligns.push(null);
  aligns.length = cols;
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l);
    while (cells.length < cols) cells.push('');
    return cells.slice(0, cols);
  });
  return { header, aligns, rows };
}

/** Text typed into a cell → safe single-line cell source. */
export function sanitizeCell(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, '<br>')
    .replace(/\\(?=\|)/g, '') // normalise existing escapes first
    .replace(/\|/g, '\\|')
    .replace(/\\$/, '\\\\')
    .trim();
}

/** Display width used for padding: CJK / full-width characters count double. */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2600 && cp <= 0x27bf) || // misc symbols / dingbats (☀ ✅ …)
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) || // emoji
      (cp >= 0x20000 && cp <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

function pad(text: string, width: number, align: Align): string {
  const extra = Math.max(0, width - displayWidth(text));
  if (align === 'right') return ' '.repeat(extra) + text;
  if (align === 'center') {
    const left = Math.floor(extra / 2);
    return ' '.repeat(left) + text + ' '.repeat(extra - left);
  }
  return text + ' '.repeat(extra);
}

/** Serialize a model into a nicely aligned GFM table (no trailing newline). */
export function serializeTable(model: TableModel): string {
  const cols = model.header.length;
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = Math.max(3, displayWidth(model.header[c] ?? ''));
    for (const row of model.rows) w = Math.max(w, displayWidth(row[c] ?? ''));
    widths.push(w);
  }
  const line = (cells: string[]) => `| ${cells.map((cell, c) => pad(cell ?? '', widths[c], model.aligns[c] ?? null)).join(' | ')} |`;
  const delim = `| ${widths
    .map((w, c) => {
      const a = model.aligns[c] ?? null;
      if (a === 'center') return `:${'-'.repeat(Math.max(1, w - 2))}:`;
      if (a === 'right') return `${'-'.repeat(Math.max(1, w - 1))}:`;
      if (a === 'left') return `:${'-'.repeat(Math.max(1, w - 1))}`;
      return '-'.repeat(w);
    })
    .join(' | ')} |`;
  return [line(model.header), delim, ...model.rows.map((r) => line(r))].join('\n');
}

// ---- structural edits (return new models) -----------------------------------------

export function insertRow(model: TableModel, index: number): TableModel {
  const rows = model.rows.slice();
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, model.header.map(() => ''));
  return { ...model, rows };
}

export function deleteRow(model: TableModel, index: number): TableModel {
  if (index < 0 || index >= model.rows.length) return model;
  const rows = model.rows.slice();
  rows.splice(index, 1);
  return { ...model, rows };
}

/** Delete body rows `from..to` (inclusive, clamped); the header row is never deleted. */
export function deleteRows(model: TableModel, from: number, to: number): TableModel {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(model.rows.length - 1, Math.max(from, to));
  if (b < a) return model;
  return { ...model, rows: model.rows.filter((_, i) => i < a || i > b) };
}

export function duplicateRow(model: TableModel, index: number): TableModel {
  if (index < 0 || index >= model.rows.length) return model;
  const rows = model.rows.slice();
  rows.splice(index + 1, 0, model.rows[index].slice());
  return { ...model, rows };
}

export function insertColumn(model: TableModel, index: number): TableModel {
  const at = Math.max(0, Math.min(index, model.header.length));
  const ins = <T>(arr: T[], v: T) => [...arr.slice(0, at), v, ...arr.slice(at)];
  return {
    header: ins(model.header, ''),
    aligns: ins(model.aligns, null),
    rows: model.rows.map((r) => ins(r, '')),
  };
}

export function deleteColumn(model: TableModel, index: number): TableModel {
  return deleteColumns(model, index, index);
}

/** Delete columns `from..to` (inclusive, clamped); at least one column is always kept. */
export function deleteColumns(model: TableModel, from: number, to: number): TableModel {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(model.header.length - 1, Math.max(from, to));
  if (b < a || b - a + 1 >= model.header.length) return model;
  const del = <T>(arr: T[]) => arr.filter((_, i) => i < a || i > b);
  return { header: del(model.header), aligns: del(model.aligns), rows: model.rows.map(del) };
}

export function moveRow(model: TableModel, from: number, to: number): TableModel {
  if (from === to || from < 0 || to < 0 || from >= model.rows.length || to >= model.rows.length) return model;
  const rows = model.rows.slice();
  const [r] = rows.splice(from, 1);
  rows.splice(to, 0, r);
  return { ...model, rows };
}

export function moveColumn(model: TableModel, from: number, to: number): TableModel {
  const n = model.header.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return model;
  const mv = <T>(arr: T[]) => {
    const a = arr.slice();
    const [x] = a.splice(from, 1);
    a.splice(to, 0, x);
    return a;
  };
  return { header: mv(model.header), aligns: mv(model.aligns), rows: model.rows.map(mv) };
}

export function setAlign(model: TableModel, col: number, align: Align): TableModel {
  const aligns = model.aligns.slice();
  aligns[col] = align;
  return { ...model, aligns };
}

// ---- ranges, copy & paste -----------------------------------------------------------------

export function normalizeRange(r: CellRange): CellRange {
  return { r0: Math.min(r.r0, r.r1), c0: Math.min(r.c0, r.c1), r1: Math.max(r.r0, r.r1), c1: Math.max(r.c0, r.c1) };
}

export function cellText(model: TableModel, r: number, c: number): string {
  return (r < 0 ? model.header[c] : model.rows[r]?.[c]) ?? '';
}

/** Cell sources of a range, row by row. */
export function rangeCells(model: TableModel, range: CellRange): string[][] {
  const { r0, c0, r1, c1 } = normalizeRange(range);
  const out: string[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row: string[] = [];
    for (let c = c0; c <= c1; c++) row.push(cellText(model, r, c));
    out.push(row);
  }
  return out;
}

/** Cell source → plain text for the clipboard (`<br>` → space, `\|` → `|`). */
export function cellToPlain(text: string): string {
  return text.replace(/<br\s*\/?>/gi, ' ').replace(/\\\|/g, '|');
}

/** Tab-separated values (spreadsheet friendly). */
export function rangeToTsv(model: TableModel, range: CellRange): string {
  return rangeCells(model, range)
    .map((row) => row.map((c) => cellToPlain(c).replace(/\t/g, ' ')).join('\t'))
    .join('\n');
}

/** A range as a standalone Markdown table; the first selected row becomes the header. */
export function rangeToMarkdown(model: TableModel, range: CellRange): string {
  const n = normalizeRange(range);
  const cells = rangeCells(model, n);
  const aligns = model.aligns.slice(n.c0, n.c1 + 1);
  if (n.r0 < 0) return serializeTable({ header: cells[0], aligns, rows: cells.slice(1) });
  return serializeTable({ header: model.header.slice(n.c0, n.c1 + 1), aligns, rows: cells });
}

/**
 * Parse clipboard text into a grid of cell sources: a Markdown table or TSV
 * (spreadsheets). Returns null for anything else, which is pasted into one cell
 * as text (line breaks become `<br>`).
 */
export function parseClipboardGrid(text: string): string[][] | null {
  const norm = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!norm) return null;
  const md = parseTable(norm.trim());
  if (md) return [md.header, ...md.rows];
  if (!norm.includes('\t')) return null;
  return norm.split('\n').map((l) => l.split('\t').map((c) => sanitizeCell(c)));
}

/** Write a grid into the table starting at (r, c), growing rows / columns as needed. */
export function pasteGrid(model: TableModel, r: number, c: number, grid: string[][]): TableModel {
  if (!grid.length) return model;
  const width = Math.max(...grid.map((g) => g.length));
  let next: TableModel = { header: model.header.slice(), aligns: model.aligns.slice(), rows: model.rows.map((row) => row.slice()) };
  while (next.header.length < c + width) next = insertColumn(next, next.header.length);
  while (next.rows.length < r + grid.length) next = insertRow(next, next.rows.length);
  grid.forEach((row, i) => {
    row.forEach((cell, j) => {
      const rr = r + i;
      if (rr < 0) next.header[c + j] = cell;
      else next.rows[rr][c + j] = cell;
    });
  });
  return next;
}

/** Empty every cell in a range. */
export function clearRange(model: TableModel, range: CellRange): TableModel {
  const { r0, c0, r1, c1 } = normalizeRange(range);
  const header = model.header.slice();
  const rows = model.rows.map((row) => row.slice());
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (r < 0) header[c] = '';
      else if (rows[r]) rows[r][c] = '';
    }
  }
  return { ...model, header, rows };
}
