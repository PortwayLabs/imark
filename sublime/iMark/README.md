# iMark for Sublime Text

Typora / Obsidian style **live-preview Markdown editing** for Sublime Text, with **Obsidian community themes loaded unchanged**. Same editor as the [iMark VS Code extension](https://github.com/sandboxgames/imark).

## How it works

Sublime Text has no embedded browser, so iMark runs a small local server inside the plugin host (Python standard library only, bound to `127.0.0.1`, protected by a random per-session token). The server serves the iMark editor to your browser and mirrors the Sublime Text buffer over a WebSocket:

- Typing in the browser edits the Sublime Text buffer (with undo history); typing in Sublime Text updates the browser.
- `Cmd/Ctrl+S` in the browser saves the file in Sublime Text.
- Following a link to another note opens it in Sublime Text and navigates the browser tab to it.
- Pasted / dropped images are stored in the attachments folder next to the note.

## Usage

1. Open a Markdown file in Sublime Text.
2. **iMark: Open in iMark** (command palette), `Cmd+Alt+M` (macOS) / `Ctrl+Alt+M` (Windows, Linux), or right-click the file, tab or sidebar entry → **Open in iMark**.
3. Edit in the browser. `Cmd/Ctrl+E` toggles reading view, `Cmd/Ctrl+/` toggles source mode; the header menu has the other options.

Set `"browser": "app"` in the settings to open the editor in a Chromium-family app window (no tabs or address bar), or give a custom command such as `["/usr/bin/firefox", "--new-window", "{url}"]`.

## Preview inside Sublime Text

Sublime Text cannot host a web view, but it can render *minihtml*. **iMark: Toggle Reading Sheet** (`Cmd+Alt+R` / `Ctrl+Alt+R`) opens a read-only rendering of the active note in the right-hand group; it follows the active Markdown file and refreshes as you type. Headings, lists, task lists, callouts, code, quotes, properties, links, wikilinks, embeds, tags, footnotes and highlights render; tables become aligned monospace text; math and Mermaid show their source with an *Open in iMark* hint. In Markdown buffers, images appear below image links / embeds and Mermaid blocks get a hint; hovering a wikilink, image, link or footnote reference shows a popup. This is a companion to the browser editor, not a replacement.

## Commands

| Command | Description |
| --- | --- |
| iMark: Open in iMark | Open the active Markdown file in the editor |
| iMark: Toggle Reading View / Toggle Source Mode | Switch modes in the connected editor |
| iMark: Toggle Readable Line Width | Obsidian's "Readable line length" |
| iMark: Copy Editor URL | Copy the editor URL to open it in another browser |
| iMark: Toggle Reading Sheet (in Sublime) | Read-only minihtml rendering of the active note in the right-hand group |
| iMark: Toggle Inline Images (in Sublime) | Show / hide images below image links in Markdown buffers |
| iMark: Select Theme… | Choose the built-in Monokai Syntax theme, Follow Sublime Text, Obsidian default or an imported theme |
| iMark: Import Obsidian Theme… | Import a theme folder, a themes folder, a vault (optionally applying its appearance settings) or a `.css` snippet |
| iMark: Remove Theme… / Open Themes Folder / Reload Theme | Manage the theme library (`Packages/User/iMark/themes`) |
| iMark: Stop Server | Stop the local server (it restarts on the next Open) |

## Settings

Preferences → Package Settings → iMark → Settings. Keys mirror the VS Code extension (`theme.name`, `theme.mode`, `theme.snippets`, `theme.accent_color`, `editor.default_mode`, `editor.readable_line_width`, `editor.table_layout`, `attachments.folder`, …) plus `browser`, `server.port`, `follow_links_in_browser`, `debug` and the `preview.*` options for the in-Sublime preview.

## Themes

Imported themes live in `Packages/User/iMark/themes/<id>/theme.css` (snippets in `Packages/User/iMark/snippets`); the selection is stored in `iMark.sublime-settings`. Theme files hot-reload when edited. **Follow Sublime Text** derives the editor colors from your Sublime Text color scheme.

## License

MIT. Bundles the Monokai Syntax Obsidian theme by lat3ncy (MIT).
