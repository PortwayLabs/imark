# iMark — Typora / Obsidian 风格的 VS Code 与 Sublime Text Markdown 编辑器

[English](README.md) | **简体中文**

iMark 把 **Typora / Obsidian 的实时预览（Live Preview）编辑体验**带进 VS Code，并且可以**原样加载 Obsidian 社区主题**。

## 特性

- **实时预览编辑**：标题、粗体/斜体/删除线/高亮、行内代码、链接、图片、列表、任务复选框、引用、代码块（语法高亮 + 语言角标）、表格（可视化编辑：区域选择、与电子表格互相复制粘贴、行 / 列手柄）、Callout、KaTeX 数学公式、脚注、`%%注释%%`、YAML 属性。光标离开元素时隐藏 Markdown 标记，进入时显示（与 Obsidian 一致）。
- **三种模式**：Live Preview / 源码模式 / 阅读视图（`Cmd/Ctrl+E` 切换阅读视图，`Cmd/Ctrl+/` 切换源码模式）。
- **Obsidian 语法**：`[[Wikilink|别名]]`、`![[嵌入.png|300]]`、`![[笔记#标题]]`、`#标签`、`==高亮==`、`> [!note]` Callout、`$...$` / `$$...$$` 公式。
- **Obsidian 社区主题**：**iMark: Manage Themes…** 可浏览、下载安装、更新和清理全部 Obsidian 社区主题；主题防护保证任何主题下排版、表格和菜单都能正常工作（见[主题管理](#主题管理)）。
- **从 vault 导入主题**：通过 **iMark: Import Obsidian Theme…** 弹窗选择主题目录 / `.obsidian` 目录 / vault 根目录 / `.css` 片段导入，主题文件复制到 iMark 自己的主题库（VS Code 为插件分配的 globalStorage 目录，不占用 `.obsidian/themes`）；导入 vault 时可一键套用其外观配置（当前主题、明暗、强调色、启用的片段）。用 **iMark: Select Theme…** 切换，选择保存在 VS Code 设置 `imark.theme.name` 中；主题文件修改后自动热更新。插件内置 **Monokai Syntax** 主题（作者 lat3ncy，MIT 许可）作为默认主题，另外提供“跟随 VS Code 配色”自适应主题与 Obsidian 默认外观。
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

## Sublime Text

iMark 同时提供 **Sublime Text 4 插件包**（build 4050+）。Sublime Text 没有内嵌浏览器，因此插件在 plugin host 内运行一个小型本地服务（仅依赖 Python 标准库，只监听 `127.0.0.1`，并带随机令牌保护），把同一套 iMark 编辑器提供给浏览器，并通过 WebSocket 与 Sublime Text 的 buffer 双向同步。

- **安装**：从 Release 下载 `iMark-<version>.sublime-package`，放入 Sublime Text 的 `Installed Packages` 目录（Preferences → Browse Packages… 的上一级），或在本仓库执行 `npm run build:sublime && npm run sublime:install`，然后重启 Sublime Text。
- **使用**：打开 Markdown 文件，在命令面板运行 **iMark: Open in iMark**（macOS `Cmd+Alt+M`，Windows / Linux `Ctrl+Alt+M`，也可用右键、标签或侧边栏菜单）。编辑器会在浏览器中打开；两边输入都会实时同步（保留 Sublime Text 撤销历史），浏览器中 `Cmd/Ctrl+S` 在 Sublime Text 中保存，链接与 wikilink 会在 Sublime Text 中打开目标笔记并让标签页跟随跳转，粘贴的图片保存到附件目录。状态栏显示当前模式与字数。
- **命令**：切换阅读视图 / 源码模式、切换可读行宽、复制编辑器 URL、选择主题…、导入 Obsidian 主题…（主题目录、themes 目录、整个 vault 及其外观设置，或单个 `.css` 片段）、删除主题…、重新加载主题、打开主题目录、停止服务。
- **设置**（Preferences → Package Settings → iMark → Settings）与 VS Code 设置一一对应，使用点号键名（`theme.name`、`theme.mode`、`theme.snippets`、`theme.accent_color`、`editor.default_mode`、`editor.readable_line_width`、`editor.table_layout`、`attachments.folder` 等），另有 `browser`（`"default"`、`"app"` 以 Chromium 系浏览器的应用窗口打开，或自定义命令如 `["/usr/bin/firefox", "--new-window", "{url}"]`）、`server.port`、`follow_links_in_browser` 与 `debug`。`theme.name: "sublime"` 选择 **Follow Sublime Text**，根据 Sublime Text 配色方案推导编辑器颜色。
- **主题**保存在 `Packages/User/iMark/themes`（片段在 `Packages/User/iMark/snippets`），编辑后热重载；主题选择保存在 `iMark.sublime-settings`。
- **Sublime 内预览**（只读，基于 Sublime 的 minihtml 渲染）：**iMark: Toggle Reading Sheet**（`Cmd/Ctrl+Alt+R`）在右侧分栏打开当前笔记的渲染视图，跟随当前 Markdown 文件并随输入刷新。表格降级为对齐的等宽文本，公式与 Mermaid 显示源码并附 *Open in iMark* 提示。Markdown buffer 中图片链接下方直接显示图片、Mermaid 块下方显示提示，悬停 wikilink、图片、链接或脚注引用会弹出预览。设置项：`preview.inline_images`、`preview.block_hints`、`preview.hover_popups`、`preview.max_image_width`、`preview.refresh_delay_ms`、`preview.max_size_kb`、`preview.show_title`。

插件源码位于 `sublime/iMark`（Python）与 `src/sublime/bridge.ts`（替代 VS Code webview API 的浏览器桥接）。`npm run sublime:link` 把源码包软链接到 Sublime Text 的 `Packages` 目录用于开发（配合 `npm run watch` 原地重建编辑器），`npm run test:sublime` 在伪造的 Sublime API 上运行 Python 测试，`npm run sublime:dev` 可在没有 Sublime Text 的情况下运行服务。

## 配置

| 设置 | 说明 | 默认 |
| --- | --- | --- |
| `imark.theme.name` | `Monokai Syntax`（内置）/ `vscode`（跟随 VS Code 配色）/ `obsidian`（Obsidian 默认外观）/ 已导入主题的 id | `Monokai Syntax` |
| `imark.theme.path` | 可选的额外主题目录（只读，例如某个 vault 的 `.obsidian/themes`）；导入的主题始终保存在 iMark 自己的主题库 | `""` |
| `imark.theme.mode` | `auto` / `light` / `dark` | `auto` |
| `imark.theme.snippets` | 加载的 CSS 片段：已导入到 iMark 片段库的文件名，或绝对路径 | `[]` |
| `imark.theme.accentColor` | 强调色，如 `#7c3aed` | `""` |
| `imark.theme.protection` | 防止主题 CSS 破坏排版：`auto`（防护层 + 自动检查与修复）/ `guard` / `off` | `auto` |
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
| `imark.editor.tableLayout` | `fit`：占满可用宽度、长单元格折行、实在放不下才滚动；`natural`：不折行、超出即滚动 | `fit` |
| `imark.attachments.folder` | 粘贴图片的保存目录（相对于笔记） | `assets` |
| `imark.attachments.linkStyle` | 插入图片链接的语法：`markdown` / `wikilink` | `markdown` |

## 主题管理

**iMark: Manage Themes…**（编辑器右上角 ⋮ 菜单和 *Select Theme…* 列表中也有入口）打开主题管理器：

- **社区主题**：列出 Obsidian 官方社区主题列表（`obsidianmd/obsidian-releases`，即 community.obsidian.md 与 Obsidian 本身使用的列表）中的全部主题，带预览图、搜索和深色 / 浅色筛选。点 **下载安装** 会按 Obsidian 的方式从主题的 GitHub 仓库下载（先取 manifest 版本对应的 release 资源，其次默认分支，最后是旧版 `obsidian.css`）。**iMark: Browse Community Themes…** 直接打开此页。下载走 VS Code 的代理设置，失败时回退到 `http.proxy` / `HTTPS_PROXY`。
- **已安装**：显示内置与已安装主题及其版本、占用空间，可 **使用**、**更新**（先点 *检查更新*）、**删除**、**从文件夹导入…**，以及 **清理…**：删除所有设置范围中都未使用的主题，并清理下载缓存。

仍可从 vault 导入主题：运行 **iMark: Import Obsidian Theme…**（或在资源管理器中右键文件夹），选择某个主题文件夹（含 `theme.css`）、整个 `themes` 目录、`.obsidian` 目录或 vault 根目录（会导入全部主题并询问是否套用 `appearance.json` 中的外观配置）、或单个 `.css` 片段。**iMark: Select Theme…** 用于快速切换，**iMark: Open Themes Folder** 打开主题库目录。

内置主题位于插件目录的 `media/themes/`。主题库位置：`<VS Code 用户数据目录>/User/globalStorage/portwaylabs.imark/themes`（macOS 为 `~/Library/Application Support/Code/User/globalStorage/portwaylabs.imark/themes`）。

### 主题防护

Obsidian 主题是为 Obsidian 编写的，其中部分规则会破坏 iMark 的排版。`imark.theme.protection`（默认 `auto`）保证任何主题下笔记都能正常编辑和阅读：

- 防护样式表位于独立的 CSS 层（`media/css/imark-guard.css`），对结构性属性的优先级高于任何主题规则（包括 `!important`）：编辑器 / 阅读视图的滚动容器、表格宽度模型、表格单元格编辑、行 / 列手柄以及 iMark 的菜单。颜色、字体、边框和间距仍由主题决定。
- 每次切换主题后 iMark 会检测当前视图：正文列被挤压或移出可视区、字号不在 9–40 px 之间、文字被隐藏或与背景同色时，会做针对性修复，并弹出提示说明是哪个主题、什么问题（可 *选择主题…* 或 *不再提示*）。问题同时记录在 **iMark** 输出面板。
- `guard` 只保留防护层；`off` 原样加载主题（用于开发主题）。

## 表格

表格在实时预览中始终保持渲染并可直接编辑：点击单元格编辑该格的 Markdown（其他格保持渲染），`Tab` / `Shift+Tab` 在格间移动（末格 `Tab` 自动新增一行），`Enter` 下移（`Shift+Enter` 插入 `<br>`），方向键可跨越格边界，`Esc` 离开表格，`Cmd/Ctrl+Z` 撤销。单元格内的复制、剪切、粘贴与普通文本框一致。

| 操作 | 方式 |
| --- | --- |
| 选择多个单元格 | 在单元格间拖动、`Shift`+点击、在已全选的单元格中按 `Shift`+方向键，或连按两次 `Cmd/Ctrl+A` 选中整张表 |
| 选择整行 / 整列 | 悬停表格，点击行左侧或列上方的手柄（同时打开行 / 列菜单） |
| 复制 / 剪切单元格 | 选区上按 `Cmd/Ctrl+C` / `X`：复制为 Markdown 表格（纯文本）和 HTML 表格，可粘贴到其他笔记或电子表格 |
| 粘贴单元格 | 把电子表格的 TSV、Markdown 表格或复制的单元格粘贴到单元格或选区，表格会按需扩展；单个值粘贴到选区会填满整个选区 |
| 清空单元格 | 选区上按 `Delete` / `Backspace` |
| 在下方 / 上方插入行 | `Cmd/Ctrl+Enter` / `Cmd/Ctrl+Shift+Enter`，或表格下方的 “+” 按钮 |
| 删除行 | `Cmd/Ctrl+Shift+Backspace`（删除选区覆盖的行），或行手柄 / 右键菜单 |
| 删除列 | `Cmd/Ctrl+Alt+Shift+Backspace`，或列手柄 / 右键菜单 |
| 移动行 | `Alt+↑` / `Alt+↓` |
| 移动列、复制行、对齐 | 行 / 列手柄菜单与右键菜单 |
| 复制或删除整张表 | 右键菜单：*Copy table as Markdown*、*Delete table*、*Edit table source* |

默认（`imark.editor.tableLayout: fit`）表格最多占满可用宽度：放得下就按自然宽度显示，放不下时长单元格按词折行，只有列宽压到最小（最长单词 / 代码 / 路径）仍放不下时才横向滚动；`tableLayout: natural` 则从不折行、超出即滚动。如需让宽表格突破可读行宽，可开启 `imark.editor.wideTables`。表格宽度模型和编辑控件属于主题防护的一部分，主题无法拉伸表格或让单元格无法选中。

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

`npm run test:sublime` 运行 Sublime Text 插件的 Python 测试（基于伪造的 Sublime API）；`npm run sublime:link` 将插件源码软链接到 Sublime Text 的 Packages 目录；`npm run sublime:dev` 在无 Sublime Text 的环境下运行服务。

## 版本发布

1. 在 `CHANGELOG.md` 的 `## Unreleased` 和 `CHANGELOG.zh-CN.md` 的 `## 未发布` 小节中写好本次变更。
2. 在干净的工作区运行发布脚本：

```bash
npm run release -- patch            # 或 minor / major / 1.2.3
npm run release -- minor --push --github-release
npm run release -- patch --dry-run  # 只做校验、测试和构建，不改任何文件
```

脚本会检查工作区与 tag、校验本地化文件、升级 `package.json` / `package-lock.json` 版本号、把“未发布”小节改为 `## <版本> (<日期>)`，依次执行类型检查 → 单元测试 → VS Code 集成测试 → 生产构建，打包出 `release/imark-<版本>.vsix`，然后提交 `chore(release): v<版本>` 并创建附注 tag `v<版本>`。可选参数：`--skip-tests`、`--skip-vscode-tests`、`--skip-changelog`、`--no-git`、`--allow-dirty`、`--out <目录>`、`--push`、`--publish`（需要 `VSCE_PAT`）、`--github-release`（需要 `gh` 命令行）。

发布脚本同时会生成 `release/iMark-<version>.sublime-package`（Sublime Text 插件包，可用 `--skip-sublime` 跳过），并在创建 GitHub Release 时一并附上。

## License

MIT
