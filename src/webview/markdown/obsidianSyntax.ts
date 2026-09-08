// Lezer Markdown extensions for Obsidian-flavoured syntax:
// ==highlight==, [[wikilinks]], ![[embeds]], #tags, $math$ / $$math$$,
// %%comments%%, YAML frontmatter and [^footnote] references.
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown';
import { tags as t, Tag } from '@lezer/highlight';

export const obsidianTags = {
  highlight: Tag.define(),
  wikilink: Tag.define(t.link),
  embed: Tag.define(t.link),
  tag: Tag.define(t.labelName),
  math: Tag.define(),
  comment: Tag.define(t.comment),
  frontmatter: Tag.define(t.meta),
  footnote: Tag.define(),
};

const Punctuation = /[!-/:-@[-`{-~¡§«¶·»¿;·՚-՟։֊־׀׃׆׳״؉؊،؍؛؞؟٪-٭۔܀-܍߷-߹࠰-࠾࡞।॥॰৽੶૰౷಄෴๏๚๛༄-༒༔༺-༽྅࿐-࿔࿙࿚၊-၏჻፠-፨᐀᙮᚛᚜᛫-᛭᜵᜶។-៖៘-៚᠀-᠊᥄᥅᨞᨟᪠-᪦᪨-᪭᭚-᭠᯼-᯿᰻-᰿᱾᱿᳀-᳇᳓‐-‧‰-⁃⁅-⁑⁓-⁞⁽⁾₍₎⌈-⌋〈〉❨-❵⟅⟆⟦-⟯⦃-⦘⧘-⧛⧼⧽⳹-⳼⳾⳿⵰⸀-⸮⸰-⹏、-〃〈-】〔-〟〰〽゠・꓾꓿꘍-꘏꙳꙾꛲-꛷꡴-꡷꣎꣏꣸-꣺꣼꤮꤯꥟꧁-꧍꧞꧟꩜-꩟꫞꫟꫰꫱꯫﴾﴿︐-︙︰-﹒﹔-﹡﹣﹨﹪﹫！-＃％-＊，-／：；？＠［-］＿｛｝｟-･]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|𐕯|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDF55-\uDF59]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5A\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDF3C-\uDF3E]|\uD806[\uDC3B\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8]|\uD809[\uDC70-\uDC74]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD81B[\uDE97-\uDE9A]|𛲟|\uD836[\uDE87-\uDE8B]|\uD83A[\uDD5E\uDD5F]/;

// ---- ==Highlight== ---------------------------------------------------------

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' };

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': obsidianTags.highlight } },
    { name: 'HighlightMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1;
        const before = cx.slice(pos - 1, pos);
        const after = cx.slice(pos + 2, pos + 3);
        const sBefore = /\s|^$/.test(before);
        const sAfter = /\s|^$/.test(after);
        const pBefore = Punctuation.test(before);
        const pAfter = Punctuation.test(after);
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !sAfter && (!pAfter || sBefore || pBefore),
          !sBefore && (!pBefore || sAfter || pAfter),
        );
      },
      after: 'Emphasis',
    },
  ],
};

// ---- [[WikiLink]] and ![[Embed]] --------------------------------------------

/** Find the end (exclusive, after `]]`) of a wikilink starting at `pos` (pointing at the first `[`). */
function scanWikiLink(cx: InlineContext, pos: number): number {
  if (cx.char(pos) !== 91 || cx.char(pos + 1) !== 91) return -1;
  let i = pos + 2;
  if (cx.char(i) === 91 || cx.char(i) === 93) return -1; // `[[[` or `[[]]`
  for (; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === 93 /* ] */) {
      if (cx.char(i + 1) === 93) return i > pos + 2 ? i + 2 : -1;
      return -1;
    }
    if (ch === 91 /* [ */ || ch === 10 /* \n */) return -1;
  }
  return -1;
}

function wikiLinkChildren(cx: InlineContext, pos: number, end: number, markLen: number, markName: string) {
  const inner = cx.slice(pos + markLen, end - 2);
  const children = [cx.elt(markName, pos, pos + markLen)];
  const pipe = inner.indexOf('|');
  const targetEnd = pipe < 0 ? end - 2 : pos + markLen + pipe;
  children.push(cx.elt('WikiLinkTarget', pos + markLen, targetEnd));
  if (pipe >= 0) {
    children.push(cx.elt('WikiLinkPipe', targetEnd, targetEnd + 1));
    if (targetEnd + 1 < end - 2) children.push(cx.elt('WikiLinkAlias', targetEnd + 1, end - 2));
  }
  children.push(cx.elt(markName, end - 2, end));
  return children;
}

export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: { 'WikiLink/...': obsidianTags.wikilink } },
    { name: 'Embed', style: { 'Embed/...': obsidianTags.embed } },
    { name: 'WikiLinkMark', style: t.processingInstruction },
    { name: 'EmbedMark', style: t.processingInstruction },
    { name: 'WikiLinkTarget', style: t.url },
    { name: 'WikiLinkPipe', style: t.processingInstruction },
    { name: 'WikiLinkAlias', style: t.link },
  ],
  parseInline: [
    {
      name: 'Embed',
      parse(cx, next, pos) {
        if (next !== 33 /* ! */) return -1;
        const end = scanWikiLink(cx, pos + 1);
        if (end < 0) return -1;
        return cx.addElement(cx.elt('Embed', pos, end, wikiLinkChildren(cx, pos, end, 3, 'EmbedMark')));
      },
      before: 'Image',
    },
    {
      name: 'WikiLink',
      parse(cx, next, pos) {
        if (next !== 91 /* [ */) return -1;
        const end = scanWikiLink(cx, pos);
        if (end < 0) return -1;
        return cx.addElement(cx.elt('WikiLink', pos, end, wikiLinkChildren(cx, pos, end, 2, 'WikiLinkMark')));
      },
      before: 'Link',
    },
  ],
};

// ---- #tags -----------------------------------------------------------------

const tagChar = /[\p{L}\p{N}\p{M}_\-/\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const tagNeedsNonNumeric = /[\p{L}\p{M}_\-/\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export const Tag_: MarkdownConfig = {
  defineNodes: [{ name: 'Tag', style: obsidianTags.tag }, { name: 'TagMark', style: t.processingInstruction }],
  parseInline: [
    {
      name: 'Tag',
      parse(cx, next, pos) {
        if (next !== 35 /* # */) return -1;
        const before = cx.slice(pos - 1, pos);
        if (before !== '' && !/[\s([{"'“‘>]/.test(before)) return -1;
        let i = pos + 1;
        let text = '';
        while (i < cx.end) {
          const cp = cx.slice(i, i + 2).codePointAt(0)!;
          const ch = String.fromCodePoint(cp);
          if (!tagChar.test(ch)) break;
          text += ch;
          i += ch.length;
        }
        if (!text || !tagNeedsNonNumeric.test(text)) return -1;
        return cx.addElement(cx.elt('Tag', pos, i, [cx.elt('TagMark', pos, pos + 1)]));
      },
      before: 'Entity',
    },
  ],
};

// ---- $inline math$ / $$display math$$ ---------------------------------------

export const Math: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: obsidianTags.math },
    { name: 'BlockMath', block: true, style: obsidianTags.math },
    { name: 'MathMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx, next, pos) {
        if (next !== 36 /* $ */) return -1;
        const before = cx.slice(pos - 1, pos);
        if (before === '\\') return -1;
        const dbl = cx.char(pos + 1) === 36;
        const markLen = dbl ? 2 : 1;
        if (!dbl) {
          const after = cx.slice(pos + 1, pos + 2);
          if (after === '' || /\s|\$/.test(after)) return -1;
        }
        let i = pos + markLen;
        for (; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === 92 /* \ */) {
            i++;
            continue;
          }
          if (ch === 36) {
            if (dbl) {
              if (cx.char(i + 1) === 36) break;
              continue;
            }
            const prev = cx.slice(i - 1, i);
            const nextCh = cx.slice(i + 1, i + 2);
            if (/\s/.test(prev)) return -1;
            if (/\d/.test(nextCh)) continue;
            break;
          }
          if (!dbl && ch === 10) return -1;
        }
        if (i >= cx.end) return -1;
        const end = i + markLen;
        return cx.addElement(
          cx.elt('InlineMath', pos, end, [cx.elt('MathMark', pos, pos + markLen), cx.elt('MathMark', i, end)]),
        );
      },
      before: 'Escape',
    },
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx: BlockContext, line: Line) {
        if (line.next !== 36 || line.text.charCodeAt(line.pos + 1) !== 36) return false;
        const from = cx.lineStart + line.pos;
        const marks = [cx.elt('MathMark', from, from + 2)];
        const rest = line.text.slice(line.pos + 2);
        const close = rest.indexOf('$$');
        if (close >= 0) {
          if (rest.slice(close + 2).trim() !== '') return false; // trailing text → inline
          const closeFrom = from + 2 + close;
          marks.push(cx.elt('MathMark', closeFrom, closeFrom + 2));
          cx.nextLine();
          cx.addElement(cx.elt('BlockMath', from, closeFrom + 2, marks));
          return true;
        }
        let to = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          const idx = line.text.indexOf('$$', line.pos);
          if (idx >= 0) {
            const closeFrom = cx.lineStart + idx;
            marks.push(cx.elt('MathMark', closeFrom, closeFrom + 2));
            to = closeFrom + 2;
            cx.nextLine();
            cx.addElement(cx.elt('BlockMath', from, to, marks));
            return true;
          }
          to = cx.lineStart + line.text.length;
        }
        cx.addElement(cx.elt('BlockMath', from, to, marks));
        return true;
      },
      endLeaf(_cx, line) {
        return line.next === 36 && line.text.charCodeAt(line.pos + 1) === 36;
      },
      before: 'FencedCode',
    },
  ],
};

// ---- %%comments%% ----------------------------------------------------------

export const ObsidianComment: MarkdownConfig = {
  defineNodes: [
    { name: 'ObsidianComment', style: obsidianTags.comment },
    { name: 'ObsidianCommentBlock', block: true, style: obsidianTags.comment },
    { name: 'ObsidianCommentMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'ObsidianComment',
      parse(cx, next, pos) {
        if (next !== 37 /* % */ || cx.char(pos + 1) !== 37) return -1;
        let i = pos + 2;
        for (; i < cx.end; i++) {
          if (cx.char(i) === 37 && cx.char(i + 1) === 37) break;
        }
        if (i >= cx.end) return -1;
        return cx.addElement(
          cx.elt('ObsidianComment', pos, i + 2, [
            cx.elt('ObsidianCommentMark', pos, pos + 2),
            cx.elt('ObsidianCommentMark', i, i + 2),
          ]),
        );
      },
      before: 'Escape',
    },
  ],
  parseBlock: [
    {
      name: 'ObsidianCommentBlock',
      parse(cx, line) {
        if (line.next !== 37 || line.text.charCodeAt(line.pos + 1) !== 37) return false;
        if (line.text.indexOf('%%', line.pos + 2) >= 0) return false; // closed on same line → inline
        const from = cx.lineStart + line.pos;
        const marks = [cx.elt('ObsidianCommentMark', from, from + 2)];
        let to = cx.lineStart + line.text.length;
        while (cx.nextLine()) {
          const idx = line.text.indexOf('%%', line.pos);
          if (idx >= 0) {
            const closeFrom = cx.lineStart + idx;
            marks.push(cx.elt('ObsidianCommentMark', closeFrom, closeFrom + 2));
            to = closeFrom + 2;
            cx.nextLine();
            cx.addElement(cx.elt('ObsidianCommentBlock', from, to, marks));
            return true;
          }
          to = cx.lineStart + line.text.length;
        }
        cx.addElement(cx.elt('ObsidianCommentBlock', from, to, marks));
        return true;
      },
      before: 'FencedCode',
    },
  ],
};

// ---- YAML frontmatter --------------------------------------------------------

export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: obsidianTags.frontmatter },
    { name: 'FrontmatterMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      parse(cx, line) {
        const first: string = line.text;
        if (cx.lineStart !== 0 || line.pos !== 0 || first !== '---') return false;
        const marks = [cx.elt('FrontmatterMark', 0, 3)];
        let to = 3;
        while (cx.nextLine()) {
          const text: string = line.text;
          if (text === '---' || text === '...') {
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, cx.lineStart + 3));
            to = cx.lineStart + 3;
            cx.nextLine();
            cx.addElement(cx.elt('Frontmatter', 0, to, marks));
            return true;
          }
          to = cx.lineStart + text.length;
        }
        // Unterminated: not a frontmatter block; let it be a horizontal rule.
        return false;
      },
      before: 'HorizontalRule',
    },
  ],
};

// ---- [^footnote] references --------------------------------------------------

export const FootnoteRef: MarkdownConfig = {
  defineNodes: [
    { name: 'FootnoteRef', style: obsidianTags.footnote },
    { name: 'FootnoteMark', style: t.processingInstruction },
    { name: 'FootnoteLabel', style: t.labelName },
  ],
  parseInline: [
    {
      name: 'FootnoteRef',
      parse(cx, next, pos) {
        if (next !== 91 /* [ */ || cx.char(pos + 1) !== 94 /* ^ */) return -1;
        let i = pos + 2;
        for (; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === 93) break;
          if (ch === 91 || ch === 32 || ch === 10) return -1;
        }
        if (i >= cx.end || i === pos + 2) return -1;
        return cx.addElement(
          cx.elt('FootnoteRef', pos, i + 1, [
            cx.elt('FootnoteMark', pos, pos + 2),
            cx.elt('FootnoteLabel', pos + 2, i),
            cx.elt('FootnoteMark', i, i + 1),
          ]),
        );
      },
      before: 'Link',
    },
  ],
};

export const obsidianSyntax: MarkdownConfig[] = [Highlight, WikiLink, Tag_, Math, ObsidianComment, Frontmatter, FootnoteRef];
