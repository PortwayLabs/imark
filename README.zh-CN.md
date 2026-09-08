# iMark — Typora / Obsidian 风格的 VS Code Markdown 编辑器

[English](README.md) | **简体中文**

iMark 把 **Typora / Obsidian 的实时预览（Live Preview）编辑体验**带进 VS Code，并且可以**原样加载 Obsidian 社区主题**。

## 特性

- **实时预览编辑**：标题、粗体/斜体/删除线/高亮、行内代码、链接、图片、列表、任务复选框、引用、代码块（语法高亮 + 语言角标）、表格（逐格可视化编辑）、Callout、KaTeX 数学公式、脚注、`%%注释%%`、YAML 属性。光标离开元素时隐藏 Markdown 标记，进入时显示（与 Obsidian 一致）。
- **三种模式**：Live Preview / 源码模式 / 阅读视图（`Cmd/Ctrl+E` 切换阅读视图，`Cmd/Ctrl+/` 切换源码模式）。
- **Obsidian 语法**：`[[Wikilink|别名]]`、`![[嵌入.png|300]]`、`![[笔记#标题]]`、`#标签`、`==高亮==`、`> [!note]` Callout、`$...$` / `$$...$$` 公式。
- **Obsidian 主题**：通过 **iMark: Import Obsidian Theme…** 弹窗选择主题目录 / `.obsidian` 目录 / vault 根目录 / `.css` 片段导入，主题文件复制到 iMark 自己的主题库（VS Code 为插件分配的 globalStorage 目录，不占用 `.obsidian/themes`）；导入 vault 时可一键套用其外观配置（当前主题、明暗、强调色、启用的片段）。用 **iMark: Select Theme…** 切换，选择保存在 VS Code 设置 `imark.theme.name` 中；主题文件修改后自动热更新。插件内置 **Monokai Syntax** 主题（作者 lat3ncy，MIT 许可）作为默认主题，另外提供“跟随 VS Code 配色”自适应主题与 Obsidian 默认外观。
- **Mermaid**：支持 Mermaid 全部图表类型（flowchart、sequence、class、state、ER、gantt、pie、mindmap、timeline、gitGraph、journey、quadrant、xychart、sankey、block、requirement、C4 等，按需懒加载），实时预览与阅读视图均可渲染并跟随明暗主题；**点击图表弹出预览层**，支持滚轮/双击缩放、拖拽平移、1:1 / 适应窗口、复制 SVG，方便查看复杂架构图。
- **编辑效率**：`[[` 自动补全笔记名；粘贴 / 拖入图片自动保存到附件目录并插入链接；Markdown 符号自动配对；`Cmd+B/I/K`、`Cmd+1~6` 标题、`Cmd+Enter` 切换复选框、`Tab/Shift+Tab` 列表缩进等 Typora 风格快捷键。
- **与 VS Code 深度集成**：作为 `.md` 文件的默认编辑器（可随时 “Reopen With…” 切回文本编辑器），复用 VS Code 的保存 / 撤销 / Git / 多窗格；状态栏显示当前模式与字数。

## 安装与运行

```bash
npm install
npm run build
```

- **调试**：在 VS Code 中按 `F5`（Run iMark Extension）。
- **打包**：`npm run package` 生成 `imark-<version>.vsix`，再执行 `code --install-extension imark-<version>.vsix`。
- **浏览器开发环境**（不依赖 VS Code，用于调样式）：`npm run serve` 然后打开 <http://localhost:8765/>，右下角可以切换 Obsidian 主题 / 明暗 / 模式。

## 配置

| 设置 | 说明 | 默认 |
| --- | --- | --- |
| `imark.theme.name` | `Monokai Syntax`（内置）/ `vscode`（跟随 VS Code 配色）/ `obsidian`（Obsidian 默认外观）/ 已导入主题的 id | `Monokai Syntax` |
| `imark.theme.path` | 可选的额外主题目录（只读，例如某个 vault 的 `.obsidian/themes`）；导入的主题始终保存在 iMark 自己的主题库 | `""` |
| `imark.theme.mode` | `auto` / `light` / `dark` | `auto` |
| `imark.theme.snippets` | 加载的 CSS 片段：已导入到 iMark 片段库的文件名，或绝对路径 | `[]` |
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
| `imark.editor.wideTables` | 允许宽表格居中扩展到编辑器宽度；关闭时限制在正文宽度内并横向滚动 | `false` |
| `imark.attachments.folder` | 粘贴图片的保存目录（相对于笔记） | `assets` |
| `imark.attachments.linkStyle` | 插入图片链接的语法：`markdown` / `wikilink` | `markdown` |

## 主题管理

1. 命令面板运行 **iMark: Import Obsidian Theme…**（或在资源管理器中右键文件夹 → Import Obsidian Theme…）。
2. 在弹窗中选择：某个主题文件夹（含 `theme.css`）、整个 `themes` 目录、`.obsidian` 目录或 vault 根目录（会导入全部主题并询问是否套用 `appearance.json` 中的外观配置）、或单个 `.css` 片段。
3. 运行 **iMark: Select Theme…** 切换主题；列表中每个已导入主题右侧有删除按钮，也可通过 **iMark: Open Themes Folder** 打开主题库目录。

内置主题位于插件目录的 `media/themes/`。导入主题的主题库位置：`<VS Code 用户数据目录>/User/globalStorage/portwaylabs.imark/themes`（macOS 为 `~/Library/Application Support/Code/User/globalStorage/portwaylabs.imark/themes`）。

## 表格

表格在实时预览中始终保持渲染并可直接编辑：点击单元格编辑该格的 Markdown（其他格保持渲染），`Tab` / `Shift+Tab` 在格间移动（末格 `Tab` 自动新增一行），`Enter` 下移（`Shift+Enter` 插入 `<br>`），方向键可跨越格边界，`Esc` 离开表格，`Cmd/Ctrl+Z` 撤销。悬停表格时右侧 / 下方出现 “+” 按钮用于添加列 / 行；右键单元格可插入 / 删除行列、设置列对齐、进入“编辑表格源码”。表格按自身最长行的自然宽度布局：单元格只有超过表格容器宽度时才折行（可用 `--imark-table-cell-max-width` 覆盖），整表宽于正文列时在表格内横向滚动。如需让宽表格突破可读行宽，可开启 `imark.editor.wideTables`。

## Mermaid

用 ```` ```mermaid ```` 代码块书写图表。光标离开代码块后即渲染为图表；点击图表打开预览弹窗（`Esc` 关闭，`+`/`-`/`0`/`1` 缩放，滚轮缩放，拖拽平移），工具栏可复制 SVG。语法错误时在原位显示错误信息，点击错误信息回到源码。

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

Webview 中运行 CodeMirror 6，并生成与 Obsidian 相同结构的 DOM（`.markdown-source-view.mod-cm6.is-live-preview .cm-s-obsidian`、`HyperMD-header-N`、`.cm-formatting`、`.callout`、`.cm-table-widget`……）。`media/css/obsidian-vars.css` 提供了 Obsidian 默认 CSS 变量，`obsidian-base.css` 用这些变量绘制编辑器，因此 Obsidian 主题只需按原样加载即可生效。文档同步通过 `CustomTextEditorProvider` 完成：Webview 发送增量修改 → 扩展应用到 `TextDocument`；外部修改则以最小 diff 回推到 Webview。

## 开发

```bash
npm run watch        # 增量构建
npm run test         # 单元测试（vitest）
npm run test:vscode  # VS Code 集成测试（下载 VS Code 并运行）
npm run typecheck
```

## 版本发布

1. 在 `CHANGELOG.md` 的 `## Unreleased` 和 `CHANGELOG.zh-CN.md` 的 `## 未发布` 小节中写好本次变更。
2. 在干净的工作区运行发布脚本：

```bash
npm run release -- patch            # 或 minor / major / 1.2.3
npm run release -- minor --push --github-release
npm run release -- patch --dry-run  # 只做校验、测试和构建，不改任何文件
```

脚本会检查工作区与 tag、校验本地化文件、升级 `package.json` / `package-lock.json` 版本号、把“未发布”小节改为 `## <版本> (<日期>)`，依次执行类型检查 → 单元测试 → VS Code 集成测试 → 生产构建，打包出 `release/imark-<版本>.vsix`，然后提交 `chore(release): v<版本>` 并创建附注 tag `v<版本>`。可选参数：`--skip-tests`、`--skip-vscode-tests`、`--skip-changelog`、`--no-git`、`--allow-dirty`、`--out <目录>`、`--push`、`--publish`（需要 `VSCE_PAT`）、`--github-release`（需要 `gh` 命令行）。

## License

MIT
