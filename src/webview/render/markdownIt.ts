// markdown-it configured to emit Obsidian-compatible HTML for the reading view,
// callout bodies and note embeds.
import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type StateBlock, type StateCore, type StateInline, type Token } from 'markdown-it';
import footnote from 'markdown-it-footnote';
import DOMPurify, { type Config as PurifyConfig } from 'dompurify';
import katex from 'katex';
import { svgIcon } from './icons';
import { calloutMeta, parseCalloutHeader } from './callouts';
import { IMAGE_EXT, AUDIO_EXT, VIDEO_EXT, PDF_EXT, MD_EXT, parseTarget, type LinkResolver } from '../links';

export interface RenderContext {
  resolver: LinkResolver;
  /** Nesting depth for embedded notes (prevents infinite recursion). */
  depth?: number;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderMath(tex: string, display: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'htmlAndMathml', strict: 'ignore' });
  } catch (e) {
    return `<span class="math-error">${escapeHtml(String(e))}</span>`;
  }
}

// ---- inline rules ------------------------------------------------------------

function highlightRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x3d || src.charCodeAt(start + 1) !== 0x3d) return false;
  if (src.charCodeAt(start + 2) === 0x3d || start + 2 >= state.posMax) return false;
  const close = src.indexOf('==', start + 2);
  if (close < 0 || close > state.posMax) return false;
  if (/\s/.test(src[start + 2]) || /\s/.test(src[close - 1])) return false;
  if (!silent) {
    const inner = src.slice(start + 2, close);
    const open = state.push('mark_open', 'mark', 1);
    open.markup = '==';
    const saveMax = state.posMax;
    state.pos = start + 2;
    state.posMax = close;
    state.md.inline.tokenize(state);
    state.pos = close;
    state.posMax = saveMax;
    const closeTok = state.push('mark_close', 'mark', -1);
    closeTok.markup = '==';
    void inner;
  }
  state.pos = close + 2;
  return true;
}

function wikilinkRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  let start = state.pos;
  let embed = false;
  if (src.charCodeAt(start) === 0x21 /* ! */ && src.charCodeAt(start + 1) === 0x5b && src.charCodeAt(start + 2) === 0x5b) {
    embed = true;
  } else if (src.charCodeAt(start) !== 0x5b || src.charCodeAt(start + 1) !== 0x5b) {
    return false;
  }
  const open = start + (embed ? 3 : 2);
  const close = src.indexOf(']]', open);
  if (close < 0 || close > state.posMax || close === open) return false;
  const inner = src.slice(open, close);
  if (/[\[\]\n]/.test(inner)) return false;
  if (!silent) {
    const tok = state.push(embed ? 'embed' : 'wikilink', '', 0);
    tok.content = inner;
  }
  state.pos = close + 2;
  return true;
}

const tagChars = /[\p{L}\p{N}\p{M}_\-/\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const tagNeedsNonNumeric = /[\p{L}\p{M}_\-/\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function tagRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x23) return false;
  const before = start > 0 ? src[start - 1] : '';
  if (before !== '' && !/[\s([{"'“‘>]/.test(before)) return false;
  let i = start + 1;
  let text = '';
  while (i < state.posMax) {
    const cp = src.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    if (!tagChars.test(ch)) break;
    text += ch;
    i += ch.length;
  }
  if (!text || !tagNeedsNonNumeric.test(text)) return false;
  if (!silent) {
    const tok = state.push('hashtag', '', 0);
    tok.content = text;
  }
  state.pos = i;
  return true;
}

function mathInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x24) return false;
  if (start > 0 && src[start - 1] === '\\') return false;
  const dbl = src.charCodeAt(start + 1) === 0x24;
  const markLen = dbl ? 2 : 1;
  if (!dbl) {
    const after = src[start + 1];
    if (after === undefined || /\s|\$/.test(after)) return false;
  }
  let i = start + markLen;
  for (; i < state.posMax; i++) {
    const ch = src.charCodeAt(i);
    if (ch === 0x5c) {
      i++;
      continue;
    }
    if (ch === 0x24) {
      if (dbl) {
        if (src.charCodeAt(i + 1) === 0x24) break;
        continue;
      }
      if (/\s/.test(src[i - 1])) return false;
      if (/\d/.test(src[i + 1] ?? '')) continue;
      break;
    }
    if (!dbl && ch === 0x0a) return false;
  }
  if (i >= state.posMax) return false;
  if (!silent) {
    const tok = state.push(dbl ? 'math_display_inline' : 'math_inline', 'span', 0);
    tok.content = src.slice(start + markLen, i);
  }
  state.pos = i + markLen;
  return true;
}

function commentInlineRule(state: StateInline, silent: boolean): boolean {
  const src = state.src;
  const start = state.pos;
  if (src.charCodeAt(start) !== 0x25 || src.charCodeAt(start + 1) !== 0x25) return false;
  const close = src.indexOf('%%', start + 2);
  if (close < 0 || close > state.posMax) return false;
  if (!silent) state.push('obsidian_comment', '', 0);
  state.pos = close + 2;
  return true;
}

// ---- block rules -------------------------------------------------------------

function mathBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  let max = state.eMarks[startLine];
  if (pos + 2 > max) return false;
  if (state.src.charCodeAt(pos) !== 0x24 || state.src.charCodeAt(pos + 1) !== 0x24) return false;
  pos += 2;
  let firstLine = state.src.slice(pos, max);
  if (silent) return true;
  let lastLine = '';
  let found = false;
  let nextLine = startLine;
  if (firstLine.trim().endsWith('$$')) {
    firstLine = firstLine.trim().slice(0, -2);
    found = true;
  }
  for (; !found; ) {
    nextLine++;
    if (nextLine >= endLine) break;
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    max = state.eMarks[nextLine];
    if (pos < max && state.tShift[nextLine] < state.blkIndent) break;
    const line = state.src.slice(pos, max);
    const idx = line.indexOf('$$');
    if (idx >= 0) {
      lastLine = line.slice(0, idx);
      found = true;
    }
  }
  state.line = nextLine + 1;
  const tok = state.push('math_block', 'div', 0);
  tok.block = true;
  tok.content =
    (firstLine.trim() ? firstLine + '\n' : '') +
    state.getLines(startLine + 1, nextLine, state.tShift[startLine], true) +
    (lastLine.trim() ? lastLine : '');
  tok.map = [startLine, state.line];
  return true;
}

function commentBlockRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  let pos = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  if (state.src.charCodeAt(pos) !== 0x25 || state.src.charCodeAt(pos + 1) !== 0x25) return false;
  if (state.src.slice(pos + 2, max).includes('%%')) return false;
  if (silent) return true;
  let nextLine = startLine;
  for (;;) {
    nextLine++;
    if (nextLine >= endLine) break;
    pos = state.bMarks[nextLine] + state.tShift[nextLine];
    if (state.src.slice(pos, state.eMarks[nextLine]).includes('%%')) break;
  }
  state.line = Math.min(nextLine + 1, endLine);
  const tok = state.push('obsidian_comment_block', '', 0);
  tok.block = true;
  tok.map = [startLine, state.line];
  return true;
}

function frontmatterRule(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
  if (startLine !== 0) return false;
  const first = state.src.slice(state.bMarks[0], state.eMarks[0]);
  if (first !== '---') return false;
  let nextLine = 0;
  let closed = false;
  for (;;) {
    nextLine++;
    if (nextLine >= endLine) break;
    const line = state.src.slice(state.bMarks[nextLine], state.eMarks[nextLine]);
    if (line === '---' || line === '...') {
      closed = true;
      break;
    }
  }
  if (!closed) return false;
  if (silent) return true;
  const tok = state.push('frontmatter', 'div', 0);
  tok.block = true;
  tok.content = state.getLines(1, nextLine, 0, false);
  tok.map = [0, nextLine + 1];
  state.line = nextLine + 1;
  return true;
}

// ---- core rules ----------------------------------------------------------------

function calloutCore(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== 'blockquote_open') continue;
    const p = tokens[i + 1];
    const inline = tokens[i + 2];
    if (!p || p.type !== 'paragraph_open' || !inline || inline.type !== 'inline') continue;
    const nl = inline.content.indexOf('\n');
    const firstLine = nl < 0 ? inline.content : inline.content.slice(0, nl);
    const header = parseCalloutHeader(firstLine);
    if (!header) continue;
    const meta = calloutMeta(header.type);
    tok.tag = 'div';
    tok.attrSet('class', 'callout' + (header.fold ? ' is-collapsible' + (header.fold === '-' ? ' is-collapsed' : '') : ''));
    tok.attrSet('data-callout', meta.type);
    tok.attrSet('data-callout-metadata', header.metadata);
    tok.attrSet('data-callout-fold', header.fold);
    const titleHtml = header.title ? state.md.renderInline(header.title, state.env) : escapeHtml(meta.title);
    const title = new state.Token('html_block', '', 0);
    title.block = true;
    title.content =
      `<div class="callout-title" dir="auto"><div class="callout-icon">${svgIcon(meta.icon)}</div>` +
      `<div class="callout-title-inner">${titleHtml}</div>` +
      (header.fold ? `<div class="callout-fold${header.fold === '-' ? ' is-collapsed' : ''}">${svgIcon('chevron-down')}</div>` : '') +
      `</div><div class="callout-content">`;
    // Strip the header line from the paragraph.
    const rest = nl < 0 ? '' : inline.content.slice(nl + 1);
    let insertAt = i + 1;
    if (rest.trim() === '') {
      tokens.splice(i + 1, 3); // paragraph_open, inline, paragraph_close
    } else {
      inline.content = rest;
    }
    tokens.splice(insertAt, 0, title);
    // Find matching close and add content wrapper close.
    let depth = 0;
    for (let j = insertAt + 1; j < tokens.length; j++) {
      if (tokens[j].type === 'blockquote_open') depth++;
      if (tokens[j].type === 'blockquote_close') {
        if (depth === 0) {
          tokens[j].tag = 'div';
          const closeContent = new state.Token('html_block', '', 0);
          closeContent.block = true;
          closeContent.content = '</div>';
          tokens.splice(j, 0, closeContent);
          break;
        }
        depth--;
      }
    }
  }
}

function taskListCore(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const li = tokens[i];
    if (li.type !== 'list_item_open') continue;
    const p = tokens[i + 1];
    const inline = tokens[i + 2];
    if (!p || p.type !== 'paragraph_open' || !inline || inline.type !== 'inline' || !inline.children) continue;
    const first = inline.children[0];
    if (!first || first.type !== 'text') continue;
    const m = /^\[([ xX\-\/!?*<>"~])\][ \t]/.exec(first.content);
    if (!m) continue;
    const mark = m[1];
    const checked = mark !== ' ';
    first.content = first.content.slice(m[0].length);
    li.attrJoin('class', 'task-list-item' + (checked ? ' is-checked' : ''));
    li.attrSet('data-task', mark.trim());
    if (li.map) li.attrSet('data-line', String(li.map[0]));
    const box = new state.Token('html_inline', '', 0);
    box.content = `<input data-task="${escapeHtml(mark.trim())}" type="checkbox" class="task-list-item-checkbox"${checked ? ' checked=""' : ''}${li.map ? ` data-line="${li.map[0]}"` : ''}>`;
    inline.children.unshift(box);
    // Mark the containing list.
    for (let j = i - 1; j >= 0; j--) {
      if (tokens[j].type === 'bullet_list_open' || tokens[j].type === 'ordered_list_open') {
        if (!String(tokens[j].attrGet('class') ?? '').includes('contains-task-list')) tokens[j].attrJoin('class', 'contains-task-list');
        break;
      }
    }
  }
}

function headingCore(state: StateCore): void {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'heading_open' && tokens[i + 1]?.type === 'inline') {
      tokens[i].attrSet('data-heading', tokens[i + 1].content);
      tokens[i].attrSet('dir', 'auto');
    }
  }
}

/** Wrap every top-level block in `<div class="el-…">` like Obsidian's reading view. */
function wrapTopLevelCore(state: StateCore): void {
  const tokens = state.tokens;
  const out: Token[] = [];
  const mk = (content: string) => {
    const t = new state.Token('html_block', '', 0);
    t.block = true;
    t.content = content;
    return t;
  };
  const elName = (tok: Token) => {
    if (tok.type === 'fence' || tok.type === 'code_block') return 'pre';
    if (tok.type === 'math_block') return 'div';
    if (tok.type === 'html_block') return 'div';
    if (tok.type === 'frontmatter') return 'div';
    return tok.tag || 'div';
  };
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.level === 0 && tok.nesting === 1) {
      out.push(mk(`<div class="el-${elName(tok)}">`), tok);
    } else if (tok.level === 0 && tok.nesting === -1) {
      out.push(tok, mk('</div>'));
    } else if (tok.level === 0 && tok.nesting === 0 && tok.block && tok.type !== 'html_block' && tok.type !== 'obsidian_comment_block') {
      out.push(mk(`<div class="el-${elName(tok)}">`), tok, mk('</div>'));
    } else {
      out.push(tok);
    }
  }
  state.tokens = out;
}

// ---- renderer ----------------------------------------------------------------

function parseFrontmatter(yaml: string): { key: string; values: string[] }[] {
  const rows: { key: string; values: string[] }[] = [];
  let current: { key: string; values: string[] } | null = null;
  for (const raw of yaml.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const kv = /^([A-Za-z0-9_\-. ]+):\s*(.*)$/.exec(line);
    if (kv && !line.startsWith(' ') && !line.startsWith('-')) {
      current = { key: kv[1].trim(), values: kv[2] ? [kv[2].replace(/^\[|\]$/g, '')] : [] };
      if (current.values.length && kv[2].startsWith('[')) current.values = kv[2].replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
      rows.push(current);
    } else if (current && /^\s*-\s+/.test(line)) {
      current.values.push(line.replace(/^\s*-\s+/, ''));
    } else if (current) {
      current.values.push(line.trim());
    }
  }
  return rows;
}

function mediaHtml(ctx: RenderContext, raw: string, block: boolean): string {
  const target = parseTarget(raw);
  const resolved = ctx.resolver.resolve(target.path);
  const name = target.path;
  const alt = target.alias ?? name;
  const size = (target.width ? ` width="${target.width}"` : '') + (target.height ? ` height="${target.height}"` : '');
  const tag = block ? 'div' : 'span';
  if (IMAGE_EXT.test(name)) {
    const src = resolved?.url ?? ctx.resolver.urlForMarkdownPath(name);
    return `<${tag} src="${escapeHtml(raw)}" alt="${escapeHtml(alt)}" class="internal-embed media-embed image-embed is-loaded"><img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}"${size}></${tag}>`;
  }
  if (AUDIO_EXT.test(name)) {
    const src = resolved?.url ?? ctx.resolver.urlForMarkdownPath(name);
    return `<${tag} src="${escapeHtml(raw)}" class="internal-embed media-embed audio-embed is-loaded"><audio controls src="${escapeHtml(src)}"></audio></${tag}>`;
  }
  if (VIDEO_EXT.test(name)) {
    const src = resolved?.url ?? ctx.resolver.urlForMarkdownPath(name);
    return `<${tag} src="${escapeHtml(raw)}" class="internal-embed media-embed video-embed is-loaded"><video controls src="${escapeHtml(src)}"${size}></video></${tag}>`;
  }
  if (PDF_EXT.test(name)) {
    const src = resolved?.url ?? ctx.resolver.urlForMarkdownPath(name);
    return `<${tag} src="${escapeHtml(raw)}" class="internal-embed pdf-embed is-loaded"><iframe src="${escapeHtml(src)}" style="width:100%;height:600px;border:0"></iframe></${tag}>`;
  }
  // Note embed: rendered asynchronously by hydrateEmbeds().
  const cls = 'internal-embed markdown-embed inline-embed' + (resolved ? ' is-loaded' : ' is-unresolved');
  const depth = ctx.depth ?? 0;
  return (
    `<div src="${escapeHtml(raw)}" class="${cls}" data-embed-target="${escapeHtml(target.path)}" data-embed-heading="${escapeHtml(target.heading ?? '')}" data-embed-depth="${depth}">` +
    `<div class="markdown-embed-title">${escapeHtml(target.alias ?? '')}</div>` +
    `<div class="markdown-embed-content"><div class="markdown-preview-view markdown-rendered"><div class="markdown-preview-sizer markdown-preview-section">` +
    (resolved ? '' : `<p class="embed-unresolved">${escapeHtml(name)}</p>`) +
    `</div></div></div>` +
    `<div class="markdown-embed-link" aria-label="Open link">${svgIcon('link')}</div></div>`
  );
}

function createMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true, linkify: true, breaks: true, typographer: false });
  md.use(footnote);
  md.inline.ruler.before('emphasis', 'highlight', highlightRule);
  md.inline.ruler.before('link', 'wikilink', wikilinkRule);
  md.inline.ruler.before('escape', 'hashtag', tagRule);
  md.inline.ruler.before('escape', 'math_inline', mathInlineRule);
  md.inline.ruler.before('escape', 'obsidian_comment', commentInlineRule);
  md.block.ruler.before('fence', 'math_block', mathBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.block.ruler.before('fence', 'obsidian_comment_block', commentBlockRule, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.block.ruler.before('hr', 'frontmatter', frontmatterRule);
  md.core.ruler.after('block', 'callout', calloutCore);
  md.core.ruler.after('inline', 'task_list', taskListCore);
  md.core.ruler.after('inline', 'heading_data', headingCore);
  md.core.ruler.push('wrap_top_level', wrapTopLevelCore);

  const r = md.renderer.rules;
  r.mark_open = () => '<mark>';
  r.mark_close = () => '</mark>';
  r.hashtag = (tokens, idx) => {
    const tag = tokens[idx].content;
    return `<a href="#${escapeHtml(tag)}" class="tag" target="_blank" rel="noopener nofollow">#${escapeHtml(tag)}</a>`;
  };
  r.math_inline = (tokens, idx) => `<span class="math math-inline is-loaded">${renderMath(tokens[idx].content, false)}</span>`;
  r.math_display_inline = (tokens, idx) => `<span class="math math-inline is-loaded">${renderMath(tokens[idx].content, true)}</span>`;
  r.math_block = (tokens, idx) => `<div class="math math-block is-loaded">${renderMath(tokens[idx].content, true)}</div>\n`;
  r.obsidian_comment = () => '';
  r.obsidian_comment_block = () => '';
  r.frontmatter = (tokens, idx) => {
    const rows = parseFrontmatter(tokens[idx].content);
    const body = rows
      .map(
        (row) =>
          `<div class="metadata-property" data-property-key="${escapeHtml(row.key)}"><div class="metadata-property-key"><span class="metadata-property-key-input">${escapeHtml(row.key)}</span></div>` +
          `<div class="metadata-property-value">${
            row.values.length > 1
              ? `<div class="multi-select-container">${row.values.map((v) => `<div class="multi-select-pill"><div class="multi-select-pill-content">${escapeHtml(v)}</div></div>`).join('')}</div>`
              : `<div class="metadata-input-longtext">${escapeHtml(row.values[0] ?? '')}</div>`
          }</div></div>`,
      )
      .join('');
    return `<div class="metadata-container" tabindex="-1"><div class="metadata-properties-heading"><div class="metadata-properties-title">Properties</div></div><div class="metadata-content"><div class="metadata-properties">${body}</div></div></div>\n`;
  };
  r.wikilink = (tokens, idx, _o, env) => {
    const ctx = env as unknown as RenderContext;
    const raw = tokens[idx].content;
    const target = parseTarget(raw);
    const resolved = ctx.resolver.resolve(target.path);
    const label = target.alias ?? (target.heading && !target.path ? `#${target.heading}` : raw.split('|')[0]);
    const cls = 'internal-link' + (resolved || !target.path ? '' : ' is-unresolved');
    return `<a data-href="${escapeHtml(raw.split('|')[0])}" href="${escapeHtml(raw.split('|')[0])}" class="${cls}" target="_blank" rel="noopener nofollow">${escapeHtml(label)}</a>`;
  };
  r.embed = (tokens, idx, _o, env) => mediaHtml(env as unknown as RenderContext, tokens[idx].content, false);

  r.image = (tokens, idx, options, env, self) => {
    const ctx = env as unknown as RenderContext;
    const tok = tokens[idx];
    const src = String(tok.attrGet('src') ?? '');
    let alt = self.renderInlineAsText(tok.children ?? [], options, env);
    const m = /^(.*?)\|(\d+)(?:x(\d+))?$/.exec(alt);
    if (m) {
      alt = m[1];
      tok.attrSet('width', m[2]);
      if (m[3]) tok.attrSet('height', m[3]);
    }
    const external = /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//');
    tok.attrSet('src', ctx.resolver.urlForMarkdownPath(src));
    tok.attrSet('alt', alt);
    const img = `<img${self.renderAttrs(tok)}>`;
    return external ? img : `<span src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" class="image-embed is-loaded">${img}</span>`;
  };

  const defaultLinkOpen = r.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  r.link_open = (tokens, idx, options, env, self) => {
    const tok = tokens[idx];
    const href = String(tok.attrGet('href') ?? '');
    const external = /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//');
    if (external) {
      tok.attrJoin('class', 'external-link');
      tok.attrSet('rel', 'noopener nofollow');
      tok.attrSet('target', '_blank');
    } else if (href.startsWith('#')) {
      tok.attrJoin('class', 'internal-link');
      tok.attrSet('data-href', href);
    } else {
      tok.attrJoin('class', 'internal-link');
      tok.attrSet('data-href', href);
      if (!MD_EXT.test(href.split('#')[0]) && !/\.[a-z0-9]{1,5}$/i.test(href.split('#')[0])) {
        tok.attrSet('data-href', href);
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  r.fence = (tokens, idx) => {
    const tok = tokens[idx];
    const info = tok.info.trim();
    const lang = info.split(/\s+/)[0] ?? '';
    const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
    return `<pre${cls} tabindex="0"><code${cls} data-lang="${escapeHtml(lang)}">${escapeHtml(tok.content)}</code><button class="copy-code-button">Copy</button></pre>\n`;
  };
  r.code_block = (tokens, idx) => `<pre tabindex="0"><code>${escapeHtml(tokens[idx].content)}</code><button class="copy-code-button">Copy</button></pre>\n`;

  const defaultTableOpen = r.table_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  r.table_open = (tokens, idx, options, env, self) => `<div class="table-wrapper">` + defaultTableOpen(tokens, idx, options, env, self);
  const defaultTableClose = r.table_close ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  r.table_close = (tokens, idx, options, env, self) => defaultTableClose(tokens, idx, options, env, self) + `</div>`;

  return md;
}

let mdInstance: MarkdownItInstance | null = null;
export function getMarkdownIt(): MarkdownItInstance {
  return (mdInstance ??= createMarkdownIt());
}

const purifyConfig: PurifyConfig = {
  ADD_ATTR: ['target', 'data-task', 'data-line', 'data-callout', 'data-callout-fold', 'data-callout-metadata', 'data-heading', 'data-href', 'data-embed-target', 'data-embed-heading', 'data-embed-depth', 'data-lang', 'src', 'alt', 'controls', 'tabindex', 'dir'],
  ADD_TAGS: ['iframe', 'audio', 'video', 'source', 'mark'],
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|vscode-webview|vscode-resource|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  FORBID_TAGS: ['script', 'style', 'object', 'embed'],
};

export function sanitize(html: string): string {
  return String(DOMPurify.sanitize(html, purifyConfig));
}

/** Render a full document (or fragment) to sanitized Obsidian-flavoured HTML. */
export function renderMarkdown(src: string, ctx: RenderContext): string {
  const md = getMarkdownIt();
  return sanitize(md.render(src, ctx as unknown as Record<string, unknown>));
}

export function renderInline(src: string, ctx: RenderContext): string {
  const md = getMarkdownIt();
  return sanitize(md.renderInline(src, ctx as unknown as Record<string, unknown>));
}
