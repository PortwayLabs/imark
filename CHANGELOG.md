# Changelog

**English** | [简体中文](CHANGELOG.zh-CN.md)

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
