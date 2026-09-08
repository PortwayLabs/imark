# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md)

## 0.2.10 (2026-09-08)
- Table width model now takes precedence over theme rules (e.g. Monokai Syntax caps reading-view tables at 62rem and stretches tables to 100%), so tables show their natural width and scroll in both reading view and live preview with any theme.

## 0.2.9 (2026-09-08)
- Table cells are no longer capped at 40em: a cell wraps only when it is wider than the table container, so tables show their full natural width in reading view and live preview when the readable line width is off (scrolling only when the table is wider than the view).

## 0.2.8 (2026-09-08)
- Tables are edited in place in live preview: click a cell to edit its Markdown, `Tab` / `Enter` / arrow keys move between cells, `Tab` on the last cell adds a row, hover "+" buttons add columns / rows, and the context menu inserts / deletes rows and columns, sets alignment or opens the table source. Cursor motion skips rendered tables.
- Tables are laid out at their natural width (cells wider than `--imark-table-cell-max-width` wrap), limited to the text column and scrolled horizontally when wider (`imark.editor.wideTables` now defaults to off); long links wrap anywhere instead of widening columns.

## 0.2.7 (2026-09-08)
- Extension publisher is now `PORTWAYLABS` (extension ID `PORTWAYLABS.imark`); repository, homepage and issue links point to github.com/sandboxgames/imark. If you installed an earlier build, uninstall the old `imark.imark` extension after upgrading.

## 0.2.6 (2026-09-08)
- Extension icon: the "M" is now filled with the cyan→violet gradient of the sparkle so the icon reads clearly on light and dark backgrounds.

## 0.2.5 (2026-09-08)
- Extension icon now has a transparent background (navy square removed, anti-aliased edges preserved).

## 0.2.4 (2026-09-08)
- New extension icon (smaller file, 128×128-friendly artwork).

## 0.2.3 (2026-09-08)
- Built-in **Monokai Syntax** theme (by lat3ncy, MIT) shipped with the extension and used as the default theme; the theme picker lists built-in themes separately.

## 0.2.2 (2026-09-08)
- Release script (`npm run release -- <patch|minor|major|x.y.z>`): bumps the version, dates the bilingual changelogs, runs type check / unit tests / VS Code integration tests / production build, packages the VSIX into `release/`, commits and tags; optional `--push`, `--publish` (Marketplace) and `--github-release`.

## 0.2.1

- Tables: column widths are computed from words instead of single characters, so long cells no longer squeeze other columns; tables wider than the readable line width grow towards the editor width (setting `imark.editor.wideTables`) and scroll horizontally only as a last resort.

## 0.2.0

- Theme library: import Obsidian themes, CSS snippets and vault appearance settings through a file dialog into iMark's own global storage; select, remove and reveal the library from the command palette. Themes are no longer read from `.obsidian/themes` implicitly; the selection is stored in VS Code settings.
- Mermaid: every diagram type renders in live preview and reading view (lazy-loaded, follows light/dark); click a diagram to open a zoomable, pannable preview modal with copy-as-SVG.
- Localized command titles and setting descriptions (English, Simplified Chinese).

## 0.1.0

- Initial release: live preview / source / reading modes, Obsidian syntax (wikilinks, embeds, tags, callouts, highlights, math, comments, frontmatter), Obsidian theme loading with hot reload, `[[` completion, image paste, Typora-style shortcuts.
