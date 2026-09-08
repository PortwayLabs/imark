# iMark — Typora / Obsidian style Markdown editor for VS Code

**English** | [简体中文](README.zh-CN.md)

iMark brings the **live-preview editing experience of Typora and Obsidian** into VS Code, and it can **load Obsidian community themes unchanged**.

## Features

- **Live preview editing**: headings, bold / italic / strikethrough / highlight, inline code, links, images, lists, task checkboxes, blockquotes, code blocks (syntax highlighting + language flair), tables (edited in place, cell by cell), callouts, KaTeX math, footnotes, `%%comments%%` and YAML properties. Markdown markup is hidden while the cursor is elsewhere and revealed when the cursor enters the element, exactly like Obsidian.
- **Three modes**: Live Preview / Source / Reading (`Cmd/Ctrl+E` toggles reading view, `Cmd/Ctrl+/` toggles source mode).
- **Obsidian syntax**: `[[Wikilink|alias]]`, `![[embed.png|300]]`, `![[Note#Heading]]`, `#tags`, `==highlight==`, `> [!note]` callouts, `$...$` / `$$...$$` math.
- **Obsidian themes**: run **iMark: Import Obsidian Theme…** and pick a theme folder, a `.obsidian` folder, a vault root or a `.css` snippet in the file dialog. Theme files are copied into iMark's own theme library (the globalStorage folder VS Code assigns to the extension, so `.obsidian/themes` is never touched). Importing a vault can also apply its appearance settings in one step (current theme, light/dark, accent color, enabled snippets). Switch with **iMark: Select Theme…**; the choice is stored in the VS Code setting `imark.theme.name` and theme files hot-reload when edited. iMark ships with the **Monokai Syntax** theme (by lat3ncy, MIT) as the default; a "Follow VS Code" adaptive theme and Obsidian's default look are built in as well.
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

## Settings

| Setting | Description | Default |
| --- | --- | --- |
| `imark.theme.name` | `Monokai Syntax` (built-in) / `vscode` (adapt to the VS Code color theme) / `obsidian` (Obsidian's default look) / id of an imported theme | `Monokai Syntax` |
| `imark.theme.path` | Optional additional themes folder, read-only (for example a vault's `.obsidian/themes`); imported themes always live in iMark's own library | `""` |
| `imark.theme.mode` | `auto` / `light` / `dark` | `auto` |
| `imark.theme.snippets` | CSS snippets to load: file names imported into iMark's snippet library, or absolute paths | `[]` |
| `imark.theme.accentColor` | Accent color, e.g. `#7c3aed` | `""` |
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

1. Run **iMark: Import Obsidian Theme…** from the command palette (or right-click a folder in the Explorer → Import Obsidian Theme…).
2. In the dialog pick a theme folder (containing `theme.css`), a whole `themes` folder, a `.obsidian` folder or a vault root (imports every theme and offers to apply the appearance settings found in `appearance.json`), or a single `.css` snippet.
3. Run **iMark: Select Theme…** to switch themes. Every imported theme has a remove button in the list; **iMark: Open Themes Folder** reveals the library on disk.

Built-in themes live in `media/themes/` inside the extension. Library location for imported themes: `<VS Code user data>/User/globalStorage/portwaylabs.imark/themes` (on macOS `~/Library/Application Support/Code/User/globalStorage/portwaylabs.imark/themes`).

## Tables

Tables stay rendered in live preview and are edited in place: click a cell to edit its Markdown (the other cells stay rendered), `Tab` / `Shift+Tab` move between cells (`Tab` on the last cell adds a row), `Enter` moves down (`Shift+Enter` inserts a `<br>`), arrow keys cross cell borders, `Esc` leaves the table, `Cmd/Ctrl+Z` undoes. Hover the table for "+" buttons that add a column / row; right-click a cell for insert / delete row and column, column alignment and "Edit table source". By default (`imark.editor.tableLayout: fit`) a table uses up to the available width: it keeps its natural width when that fits, long cells wrap by words when it does not, and the table scrolls horizontally only when even the minimal column widths (longest word / code / path) do not fit. `tableLayout: natural` never wraps and scrolls instead. Set `imark.editor.wideTables` to let wide tables grow past the readable line width.

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

A CodeMirror 6 editor runs inside the webview and produces the same DOM structure Obsidian does (`.markdown-source-view.mod-cm6.is-live-preview .cm-s-obsidian`, `HyperMD-header-N`, `.cm-formatting`, `.callout`, `.cm-table-widget`, …). `media/css/obsidian-vars.css` provides Obsidian's default CSS variables and `obsidian-base.css` draws the editor with them, so an Obsidian theme only has to be loaded as-is. Document synchronization goes through a `CustomTextEditorProvider`: the webview sends incremental changes that the extension applies to the `TextDocument`; external changes are pushed back to the webview as a minimal diff.

## Development

```bash
npm run watch        # incremental build
npm run test         # unit tests (vitest)
npm run test:vscode  # VS Code integration tests (downloads VS Code and runs them)
npm run typecheck
```

## Releasing

1. Describe the changes under a `## Unreleased` section in `CHANGELOG.md` and `## 未发布` in `CHANGELOG.zh-CN.md`.
2. Run the release script from a clean working tree:

```bash
npm run release -- patch            # or minor / major / 1.2.3
npm run release -- minor --push --github-release
npm run release -- patch --dry-run  # validate, test and build only
```

The script checks the tree and tag, validates the localization bundles, bumps `package.json` / `package-lock.json`, turns the Unreleased sections into `## <version> (<date>)`, runs type check → unit tests → VS Code integration tests → production build, packages `release/imark-<version>.vsix`, then commits `chore(release): v<version>` and creates the annotated tag `v<version>`. Options: `--skip-tests`, `--skip-vscode-tests`, `--skip-changelog`, `--no-git`, `--allow-dirty`, `--out <dir>`, `--push`, `--publish` (needs `VSCE_PAT`), `--github-release` (needs the `gh` CLI).

## License

MIT
