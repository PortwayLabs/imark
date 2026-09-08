# iMark — Typora / Obsidian 风格的 VS Code Markdown 编辑器

iMark 把 **Typora / Obsidian 的实时预览（Live Preview）编辑体验**带进 VS Code，并且可以**直接加载 Obsidian 社区主题**（`.obsidian/themes/<主题>/theme.css`）。

## 特性

- **实时预览编辑**：标题、粗体/斜体/删除线/高亮、行内代码、链接、图片、列表、任务复选框、引用、代码块（语法高亮 + 语言角标）、表格、Callout、KaTeX 数学公式、脚注、`%%注释%%`、YAML 属性。光标离开元素时隐藏 Markdown 标记，进入时显示（与 Obsidian 一致）。
- **三种模式**：Live Preview / 源码模式 / 阅读视图（`Cmd/Ctrl+E` 切换阅读视图，`Cmd/Ctrl+/` 切换源码模式）。
- **Obsidian 语法**：`[[Wikilink|别名]]`、`![[嵌入.png|300]]`、`![[笔记#标题]]`、`#标签`、`==高亮==`、`> [!note]` Callout、`$...$` / `$$...$$` 公式。
- **Obsidian 主题**：自动检测 vault 的 `.obsidian/appearance.json`，或通过 **iMark: Select Obsidian Theme…** 手动选择；主题文件修改后自动热更新；支持 CSS 片段（snippets）与强调色覆盖。默认还提供“跟随 VS Code 配色”的自适应主题。
- **编辑效率**：`[[` 自动补全笔记名；粘贴 / 拖入图片自动保存到附件目录并插入链接；Markdown 符号自动配对；`Cmd+B/I/K`、`Cmd+1~6` 标题、`Cmd+Enter` 切换复选框、`Tab/Shift+Tab` 列表缩进等 Typora 风格快捷键。
- **与 VS Code 深度集成**：作为 `.md` 文件的默认编辑器（可随时 “Reopen With…” 切回文本编辑器），撑起 VS Code 的保存 / 撤销 / Git / 多窗格；状态栏显示当前模式与字数。

## 安装与运行

```bash
npm install
npm run build
```

- **调试**：在 VS Code 中按 `F5`（Run iMark Extension）。
- **打包**：`npm run package` 生成 `imark-<version>.vsix`，再执行 `code --install-extension imark-0.1.0.vsix`。
- **浏览器开发环境**（不依赖 VS Code，用于调样式）：`npm run serve` 然后打开 <http://localhost:8765/>，右下角可以切换 Obsidian 主题 / 明暗 / 模式。

## 配置

| 设置 | 说明 | 默认 |
| --- | --- | --- |
| `imark.theme.name` | `auto`（读取 vault 的 appearance.json）/ `vscode`（跟随 VS Code 配色）/ `obsidian`（Obsidian 默认外观）/ 主题文件夹名 | `auto` |
| `imark.theme.path` | Obsidian 主题目录（通常是 `<vault>/.obsidian/themes`），留空自动检测 | `""` |
| `imark.theme.mode` | `auto` / `light` / `dark` | `auto` |
| `imark.theme.snippets` | 额外加载的 CSS 片段（绝对路径或 `.obsidian/snippets` 中的文件名） | `[]` |
| `imark.theme.accentColor` | 强调色，如 `#7c3aed` | `""` |
| `imark.editor.defaultMode` | `live` / `source` / `reading` | `live` |
| `imark.editor.readableLineWidth` | 限制行宽（Obsidian 的 Readable line length） | `true` |
| `imark.editor.showInlineTitle` | 在正文顶部显示文件名标题 | `true` |
| `imark.editor.showHeader` | 显示 Obsidian 风格的视图头部 | `true` |
| `imark.editor.fontSize` | 字号（px），0 使用主题默认 | `0` |
| `imark.editor.lineNumbers` | 源码模式显示行号 | `false` |
| `imark.editor.spellcheck` | 启用拼写检查 | `false` |
| `imark.editor.autoPairMarkdown` | 自动配对 `*` `_` `` ` `` `~` `=` `$` | `true` |
| `imark.editor.smartClickLinks` | 标记隐藏时单击即可打开链接（`Cmd/Ctrl+点击` 始终可用） | `true` |
| `imark.attachments.folder` | 粘贴图片的保存目录（相对于笔记） | `assets` |
| `imark.attachments.linkStyle` | 插入图片链接的语法：`markdown` / `wikilink` | `markdown` |

## 快捷键（编辑器内）

| 快捷键 | 功能 |
| --- | --- |
| `Cmd/Ctrl+B` / `I` | 粗体 / 斜体 |
| `Cmd/Ctrl+\`` | 行内代码 |
| `Cmd/Ctrl+Shift+H` | 高亮 |
| `Cmd/Ctrl+Shift+X` 或 `Alt+Shift+5` | 删除线 |
| `Cmd/Ctrl+K` / `Cmd/Ctrl+Shift+K` | 插入链接 / Wikilink |
| `Cmd/Ctrl+0…6` | 段落 / 一~六级标题 |
| `Cmd/Ctrl+Alt+U / O / X / Q` | 无序列表 / 有序列表 / 任务列表 / 引用 |
| `Cmd/Ctrl+Alt+C / T / M / N / -` | 代码块 / 表格 / 公式块 / Callout / 分隔线 |
| `Cmd/Ctrl+Enter` | 切换复选框（无复选框时跟随光标处链接） |
| `Alt+Enter` | 打开光标处链接 |
| `Cmd/Ctrl+E` | 阅读视图 ⇄ 编辑 |
| `Cmd/Ctrl+/` | Live Preview ⇄ 源码模式 |
| `Tab` / `Shift+Tab` | 列表缩进 / 反缩进 |
| `Cmd/Ctrl+F` | 查找 / 替换 |

## 工作原理

Webview 中运行 CodeMirror 6，并生成与 Obsidian 相同结构的 DOM（`.markdown-source-view.mod-cm6.is-live-preview .cm-s-obsidian`、`HyperMD-header-N`、`.cm-formatting`、`.callout`、`.cm-table-widget`…）。`media/css/obsidian-vars.css` 提供了 Obsidian 默认 CSS 变量，`obsidian-base.css` 用这些变量绘制编辑器，因此 Obsidian 主题只需按原样加载即可生效。文档同步通过 `CustomTextEditorProvider` 完成：Webview 发送增量修改 → 扩展应用到 `TextDocument`；外部修改则以最小 diff 回推到 Webview。

## 开发

```bash
npm run watch        # 增量构建
npm run test         # 单元测试（vitest）
npm run test:vscode  # VS Code 集成测试（下载 VS Code 并运行）
npm run typecheck
```

## License

MIT
