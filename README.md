# iMark — Typora / Obsidian style Markdown editor for VS Code and Sublime Text

**English** | [简体中文](README.zh-CN.md)

iMark brings the **live-preview editing experience of Typora and Obsidian** into VS Code — and, as a [Sublime Text package](#sublime-text), into Sublime Text — and it can **load Obsidian community themes unchanged**.

## Features

- **Live preview editing**: headings, bold / italic / strikethrough / highlight, inline code, links, images, lists, task checkboxes, blockquotes, code blocks (syntax highlighting + language flair), tables (edited in place: cell ranges, copy / paste with spreadsheets, row / column handles), callouts, KaTeX math, footnotes, `%%comments%%` and YAML properties. Markdown markup is hidden while the cursor is elsewhere and revealed when the cursor enters the element, exactly like Obsidian.
- **Three modes**: Live Preview / Source / Reading (`Cmd/Ctrl+E` toggles reading view, `Cmd/Ctrl+/` toggles source mode).
- **Obsidian syntax**: `[[Wikilink|alias]]`, `![[embed.png|300]]`, `![[Note#Heading]]`, `#tags`, `==highlight==`, `> [!note]` callouts, `$...$` / `$$...$$` math.
- **Obsidian community themes**: **iMark: Manage Themes…** browses, installs, updates and cleans up all Obsidian community themes; a theme guard keeps the layout, tables and menus working whatever a theme does (see [Theme management](#theme-management)).
- **Obsidian themes from a vault**: run **iMark: Import Obsidian Theme…** and pick a theme folder, a `.obsidian` folder, a vault root or a `.css` snippet in the file dialog. Theme files are copied into iMark's own theme library (the globalStorage folder VS Code assigns to the extension, so `.obsidian/themes` is never touched). Importing a vault can also apply its appearance settings in one step (current theme, light/dark, accent color, enabled snippets). Switch with **iMark: Select Theme…**; the choice is stored in the VS Code setting `imark.theme.name` and theme files hot-reload when edited. iMark ships with the **Monokai Syntax** theme (by lat3ncy, MIT) as the default; a "Follow VS Code" adaptive theme and Obsidian's default look are built in as well.
- **Mermaid**: every Mermaid diagram type (flowchart, sequence, class, state, ER, gantt, pie, mindmap, timeline, gitGraph, journey, quadrant, xychart, sankey, block, requirement, C4, … loaded on demand) renders in live preview and reading view and follows the light/dark theme. **Click a diagram to open a preview modal** with wheel / double-click zoom, drag to pan, 1:1 / fit-to-window and copy-as-SVG, which makes large architecture diagrams easy to inspect.
- **Editing helpers**: `[[` completes note names; pasted or dropped images are saved into the attachment folder and linked automatically; Markdown symbols auto-pair; Typora-style shortcuts such as `Cmd+B/I/K`, `Cmd+1…6` for headings, `Cmd+Enter` to toggle a checkbox and `Tab/Shift+Tab` for list indentation.
- **Deep VS Code integration**: iMark is the default editor for `.md` files (use "Reopen With…" to switch back to the text editor at any time) and builds on VS Code's save / undo / Git / split editors; the status bar shows the current mode and word count.

## Install & run

```bash
npm install
npm run build
```

- **Debug**: press `F5` in VS Code (Run iMark Extension).
- **Package**: `npm run package` produces `imark-<version>.vsix`; install it with `code --install-extension imark-<version>.vsix`.
- **Browser harness** (no VS Code needed, handy for styling work): `npm run serve`, then open <http://localhost:8765/>. The panel in the bottom-right corner switches Obsidian themes, light/dark and editor modes.

## Sublime Text

iMark also ships as a **Sublime Text 4 package** (build 4050+). Sublime Text has no embedded browser, so the package runs a small local server inside the plugin host (Python standard library only, bound to `127.0.0.1`, protected by a random per-run token) that serves the same iMark editor to your browser and mirrors the Sublime Text buffer over a WebSocket.

- **Install**: download `iMark-<version>.sublime-package` from the release, drop it into Sublime Text's `Installed Packages` folder (Preferences → Browse Packages… → one level up) or, from this repo, `npm run build:sublime && npm run sublime:install`. Restart Sublime Text.
- **Use**: open a Markdown file and run **iMark: Open in iMark** from the command palette (`Cmd+Alt+M` on macOS, `Ctrl+Alt+M` on Windows / Linux, or the context, tab and sidebar menus). The editor opens in your browser; typing on either side updates the other (with Sublime Text undo history), `Cmd/Ctrl+S` in the browser saves the file in Sublime Text, links and wikilinks open the target note in Sublime Text and navigate the tab, pasted images are stored in the attachments folder. The status bar shows the current mode and word count.
- **Commands**: Toggle Reading View / Source Mode, Toggle Readable Line Width, Copy Editor URL, Select Theme…, Import Obsidian Theme… (theme folder, themes folder, vault with its appearance settings, or a `.css` snippet), Remove Theme…, Reload Theme, Open Themes Folder, Stop Server.
- **Settings** (Preferences → Package Settings → iMark → Settings) mirror the VS Code settings with dotted keys (`theme.name`, `theme.mode`, `theme.snippets`, `theme.accent_color`, `editor.default_mode`, `editor.readable_line_width`, `editor.table_layout`, `attachments.folder`, …) plus `browser` (`"default"`, `"app"` for a Chromium-family app window without tabs, or a custom command such as `["/usr/bin/firefox", "--new-window", "{url}"]`), `server.port`, `follow_links_in_browser` and `debug`. `theme.name: "sublime"` selects **Follow Sublime Text**, which derives the editor colors from your Sublime Text color scheme.
- **Themes** live in `Packages/User/iMark/themes` (snippets in `Packages/User/iMark/snippets`) and hot-reload when edited; the selection is stored in `iMark.sublime-settings`.
- **Preview inside Sublime Text** (read-only, rendered with Sublime's minihtml): **iMark: Toggle Reading Sheet** (`Cmd/Ctrl+Alt+R`) opens a rendering of the active note in the right-hand group that follows the active Markdown file and refreshes as you type. Tables become aligned monospace text; math and Mermaid show their source with an *Open in iMark* hint. Markdown buffers show images below image links and a hint under Mermaid blocks, and hovering a wikilink, image, link or footnote reference pops up a preview. Settings: `preview.inline_images`, `preview.block_hints`, `preview.hover_popups`, `preview.max_image_width`, `preview.refresh_delay_ms`, `preview.max_size_kb`, `preview.show_title`.

Package sources: `sublime/iMark` (Python) and `src/sublime/bridge.ts` (browser bridge that stands in for the VS Code webview API). `npm run sublime:link` symlinks the source package into Sublime Text's `Packages` folder for development (`npm run watch` rebuilds the editor in place), `npm run test:sublime` runs the Python tests against a fake Sublime API, and `npm run sublime:dev` runs the server without Sublime Text.

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `imark.theme.name` | `Monokai Syntax` (built-in) / `vscode` (adapt to the VS Code color theme) / `obsidian` (Obsidian's default look) / id of an imported theme | `Monokai Syntax` |
| `imark.theme.path` | Optional additional themes folder, read-only (for example a vault's `.obsidian/themes`); imported themes always live in iMark's own library | `""` |
| `imark.theme.mode` | `auto` / `light` / `dark` | `auto` |
| `imark.theme.snippets` | CSS snippets to load: file names imported into iMark's snippet library, or absolute paths | `[]` |
| `imark.theme.accentColor` | Accent color, e.g. `#7c3aed` | `""` |
| `imark.theme.protection` | Protect the layout from theme CSS: `auto` (guard layer + check and repair), `guard`, `off` | `auto` |
| `imark.editor.defaultMode` | `live` / `source` / `reading` | `live` |
| `imark.editor.readableLineWidth` | Limit the line width (Obsidian's "Readable line length") | `true` |
| `imark.editor.showInlineTitle` | Show the file name as a title above the note | `true` |
| `imark.editor.showHeader` | Show the Obsidian-style view header | `true` |
| `imark.editor.fontSize` | Font size in px; 0 uses the theme default | `0` |
| `imark.editor.lineNumbers` | Show line numbers in source mode | `false` |
| `imark.editor.spellcheck` | Enable spell checking | `false` |
| `imark.editor.autoPairMarkdown` | Auto-pair `*` `_` `` ` `` `~` `=` `$` | `true` |
| `imark.editor.smartClickLinks` | Open links with a plain click while their markup is hidden (`Cmd/Ctrl+click` always works) | `true` |
| `imark.editor.wideTables` | Let tables wider than the readable line width grow (centred) towards the editor width; off = limit to the text width and scroll | `false` |
| `imark.editor.tableLayout` | `fit`: use the available width, wrap long cells, scroll as a last resort; `natural`: never wrap, scroll when wider | `fit` |
| `imark.attachments.folder` | Folder for pasted images, relative to the note | `assets` |
| `imark.attachments.linkStyle` | Link syntax for inserted images: `markdown` / `wikilink` | `markdown` |

## Theme management

**iMark: Manage Themes…** (also in the editor's ⋮ menu and in *Select Theme…*) opens the theme manager:

- **Community** lists every theme of the official Obsidian community list (`obsidianmd/obsidian-releases`, the list community.obsidian.md and Obsidian itself use) with screenshots, search and a dark / light filter. **Install** downloads the theme from its GitHub repository the way Obsidian does (release asset of the manifest version, then the default branch, then the legacy `obsidian.css`). **iMark: Browse Community Themes…** opens this tab directly. Downloads go through VS Code's proxy settings and fall back to `http.proxy` / `HTTPS_PROXY`.
- **Installed** shows built-in and installed themes with version and size: **Use**, **Update** (after *Check for updates*), **Remove**, **Import from folder…** and **Clean up…**, which removes the themes not selected in any settings scope and clears the download cache.

Themes from a vault can still be imported: run **iMark: Import Obsidian Theme…** (or right-click a folder in the Explorer) and pick a theme folder (containing `theme.css`), a whole `themes` folder, a `.obsidian` folder or a vault root (imports every theme and offers to apply the appearance settings found in `appearance.json`), or a single `.css` snippet. **iMark: Select Theme…** switches themes quickly; **iMark: Open Themes Folder** reveals the library on disk.

Built-in themes live in `media/themes/` inside the extension. Library location: `<VS Code user data>/User/globalStorage/portwaylabs.imark/themes` (on macOS `~/Library/Application Support/Code/User/globalStorage/portwaylabs.imark/themes`).

### Theme protection

Obsidian themes are written for Obsidian, and some of their rules can break iMark's layout. `imark.theme.protection` (default `auto`) keeps notes usable with any theme:

- A guard stylesheet in a CSS cascade layer (`media/css/imark-guard.css`) wins over every theme rule, including `!important` ones, for structural properties only: the editor / reading-view scroll containers, the table width model, table cell editing, row / column handles and iMark's menus. Colours, fonts, borders and spacing stay theme-controlled.
- After each theme change iMark measures the visible view. A squeezed or off-screen text column, a font size outside 9–40 px, hidden text or text with the background colour is repaired with targeted overrides, and a notice names the theme and the problem (with *Select theme…* and *Don't show again*). Problems are also logged to the **iMark** output channel.
- `guard` keeps only the guard layer; `off` loads themes exactly as they are (for theme development).

## Tables

Tables stay rendered in live preview and are edited in place: click a cell to edit its Markdown (the other cells stay rendered), `Tab` / `Shift+Tab` move between cells (`Tab` on the last cell adds a row), `Enter` moves down (`Shift+Enter` inserts a `<br>`), arrow keys cross cell borders, `Esc` leaves the table, `Cmd/Ctrl+Z` undoes. Copy, cut and paste work inside cells as in any text field.

| Action | How |
| --- | --- |
| Select cells | Drag across cells, `Shift`+click, `Shift`+arrow from a fully selected cell, or `Cmd/Ctrl+A` twice for the whole table |
| Select a row / column | Hover the table and click the handle on the left of the row or above the column (it opens the row / column menu) |
| Copy / cut cells | `Cmd/Ctrl+C` / `X` on a selection: copies a Markdown table (plain text) plus an HTML table, so it pastes into other notes and into spreadsheets |
| Paste cells | Paste TSV from a spreadsheet, a Markdown table or copied cells into a cell or a selection; the table grows as needed. One value pasted over a selection fills it |
| Clear cells | `Delete` / `Backspace` on a selection |
| Insert row below / above | `Cmd/Ctrl+Enter` / `Cmd/Ctrl+Shift+Enter`, or the "+" button below the table |
| Delete row | `Cmd/Ctrl+Shift+Backspace` (the rows of a selection), or the row handle / context menu |
| Delete column | `Cmd/Ctrl+Alt+Shift+Backspace`, or the column handle / context menu |
| Move row | `Alt+Up` / `Alt+Down` |
| Move column, duplicate row, alignment | Row / column handle menus and the right-click menu |
| Copy or delete the whole table | Right-click menu: *Copy table as Markdown*, *Delete table*, *Edit table source* |

By default (`imark.editor.tableLayout: fit`) a table uses up to the available width: it keeps its natural width when that fits, long cells wrap by words when it does not, and the table scrolls horizontally only when even the minimal column widths (longest word / code / path) do not fit. `tableLayout: natural` never wraps and scrolls instead. Set `imark.editor.wideTables` to let wide tables grow past the readable line width. The table width model and the editing controls are part of the theme guard, so themes cannot stretch tables or make cells unselectable.

## Mermaid

Write diagrams in ```` ```mermaid ```` code blocks. The block renders as soon as the cursor leaves it. Click the diagram to open the preview modal (`Esc` closes, `+` / `-` / `0` / `1` zoom, wheel to zoom, drag to pan); the toolbar copies the SVG. Syntax errors are shown in place; clicking the error returns to the source.

## Keyboard shortcuts (inside the editor)

| Shortcut | Action |
| --- | --- |
| `Cmd/Ctrl+B` / `I` | Bold / italic |
| `Cmd/Ctrl+\`` | Inline code |
| `Cmd/Ctrl+Shift+H` | Highlight |
| `Cmd/Ctrl+Shift+X` or `Alt+Shift+5` | Strikethrough |
| `Cmd/Ctrl+K` / `Cmd/Ctrl+Shift+K` | Insert link / wikilink |
| `Cmd/Ctrl+0…6` | Paragraph / heading level 1–6 |
| `Cmd/Ctrl+Alt+U / O / X / Q` | Bullet list / numbered list / task list / blockquote |
| `Cmd/Ctrl+Alt+C / T / M / N / -` | Code block / table / math block / callout / horizontal rule |
| `Cmd/Ctrl+Enter` | Toggle checkbox (follows the link under the cursor when there is no checkbox) |
| `Alt+Enter` | Follow the link under the cursor |
| `Cmd/Ctrl+E` | Reading view ⇄ editing |
| `Cmd/Ctrl+/` | Live Preview ⇄ Source mode |
| `Tab` / `Shift+Tab` | Indent / outdent list item |
| `Cmd/Ctrl+F` | Find / replace |

## How it works

A CodeMirror 6 editor runs inside the webview (or, for Sublime Text, in a browser page served by the plugin) and produces the same DOM structure Obsidian does (`.markdown-source-view.mod-cm6.is-live-preview .cm-s-obsidian`, `HyperMD-header-N`, `.cm-formatting`, `.callout`, `.cm-table-widget`, …). `media/css/obsidian-vars.css` provides Obsidian's default CSS variables and `obsidian-base.css` draws the editor with them, so an Obsidian theme only has to be loaded as-is. Document synchronization goes through a `CustomTextEditorProvider`: the webview sends incremental changes that the extension applies to the `TextDocument`; external changes are pushed back to the webview as a minimal diff.

## Development

```bash
npm run watch        # incremental build
npm run test         # unit tests (vitest)
npm run test:vscode  # VS Code integration tests (downloads VS Code and runs them)
npm run typecheck
npm run test:sublime  # Sublime Text package tests (python3, fake Sublime API)
npm run sublime:link  # symlink the Sublime Text package into Packages/ for development
npm run sublime:dev   # run the Sublime Text server without Sublime Text (dev/sample.md)
```

## Releasing

1. Describe the changes under a `## Unreleased` section in `CHANGELOG.md` and `## 未发布` in `CHANGELOG.zh-CN.md`.
2. Run the release script from a clean working tree:

```bash
npm run release -- patch            # or minor / major / 1.2.3
npm run release -- minor --push --github-release
npm run release -- patch --dry-run  # validate, test and build only
```

The script checks the tree and tag, validates the localization bundles, bumps `package.json` / `package-lock.json`, turns the Unreleased sections into `## <version> (<date>)`, runs type check → unit tests (vitest + the Sublime Text package tests) → VS Code integration tests → production build, packages `release/imark-<version>.vsix` and `release/iMark-<version>.sublime-package`, then commits `chore(release): v<version>` and creates the annotated tag `v<version>`. Options: `--skip-tests`, `--skip-vscode-tests`, `--skip-sublime`, `--skip-changelog`, `--no-git`, `--allow-dirty`, `--out <dir>`, `--push`, `--publish` (needs `VSCE_PAT`), `--github-release` (needs the `gh` CLI).

## License

MIT
