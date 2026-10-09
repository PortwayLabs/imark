# 更新日志

[English](CHANGELOG.md) | **简体中文**

## 0.3.0 (2026-10-09)
- **表格编辑。** VS Code 中表格单元格内的复制、剪切、粘贴恢复正常：表格不再拦截所有按键，`Cmd/Ctrl+C` / `V` / `X` / `S` 能重新交给 VS Code 处理。支持选择单元格区域（拖动、`Shift`+点击、`Shift`+方向键、连按两次 `Cmd/Ctrl+A`、行 / 列手柄），可复制为 Markdown + HTML 表格、剪切、按 `Delete` 清空，或粘贴电子表格的 TSV、Markdown 表格或复制的单元格（表格按需扩展）。每行 / 每列的悬停手柄可打开行 / 列菜单（插入、复制行、移动、复制、清空、删除、对齐）。新快捷键：`Cmd/Ctrl+Shift+Backspace` 删除行，`Cmd/Ctrl+Alt+Shift+Backspace` 删除列，`Cmd/Ctrl+Shift+Enter` 在上方插入行，`Alt+↑/↓` 移动行。右键菜单新增 *Copy table as Markdown* 与 *Delete table*。修复：单元格获得焦点时做结构性修改，可能导致表格被重建、光标落入表格源码。
- **主题管理器**（*iMark: Manage Themes…* / *Browse Community Themes…*）：浏览全部 Obsidian 社区主题（预览图、搜索、深色 / 浅色筛选），按 Obsidian 的方式从 GitHub 下载安装，切换、检查更新、更新、删除主题，并可清理未使用的主题和下载缓存。下载使用 VS Code 的代理设置，失败时回退到 `http.proxy` / `HTTPS_PROXY`。
- **主题防护**（`imark.theme.protection`，默认 `auto`）：位于独立 CSS 层的防护样式表保证编辑器结构、滚动容器、表格宽度模型、表格编辑和 iMark 菜单在任何主题下都能工作（优先级高于主题的 `!important` 规则）；每次切换主题后自动检查并修复被挤压或移出视图的正文列、异常字号、被隐藏或看不见的文字，并提示是哪个主题、什么问题。`guard` 只保留防护层，`off` 原样加载主题。
- **Sublime Text：编辑器内预览。** *iMark: Toggle Reading Sheet*（`Cmd/Ctrl+Alt+R`）在右侧分栏打开当前笔记的只读渲染视图，跟随当前 Markdown 文件并随输入刷新（标题、列表、任务列表、callout、代码、引用、属性、链接、wikilink、嵌入、标签、脚注、高亮；表格降级为对齐的等宽文本，公式与 Mermaid 显示源码并附 “Open in iMark” 提示）。Markdown buffer 中在图片链接 / 嵌入下方显示图片、在 Mermaid 块下方显示提示；悬停 wikilink、图片、链接或脚注引用会弹出预览（笔记摘录、图片、URL、脚注内容）。基于 Sublime 的 minihtml 渲染，是浏览器编辑器的补充而非替代。设置项：`preview.inline_images`、`preview.block_hints`、`preview.hover_popups`、`preview.max_image_width`、`preview.refresh_delay_ms`、`preview.max_size_kb`、`preview.show_title`。
- 粘贴 / 拖入的图片保留原始文件名（`diagram.png` 仍为 `diagram.png`，重名时追加 `diagram 1.png`）；只有剪贴板式的名字（`image.png`、`image 2`、`blob`、`screenshot …`、`Pasted image …`）才改为 `Pasted image <时间戳>`。此前任何单词文件名都会被改名。VS Code 扩展与 Sublime Text 插件使用同一规则（`src/shared/attachmentName.ts`）。
- **支持 Sublime Text**：iMark 现在同时提供 Sublime Text 4 插件包（`release/iMark-<version>.sublime-package`，`npm run build:sublime`）。Sublime Text 没有 WebView，因此插件在 plugin host 内启动一个仅依赖 Python 标准库的本地服务（只监听 `127.0.0.1`，带随机令牌），把同一套编辑器提供给浏览器，并通过 WebSocket 与 Sublime 的 buffer 双向同步：编辑双向实时同步且保留撤销历史，浏览器中 `Cmd/Ctrl+S` 在 Sublime 中保存，链接 / wikilink 会在 Sublime 中打开目标笔记并让标签页跟随跳转，粘贴的图片保存到附件目录。命令：Open in iMark（`Cmd+Alt+M` / `Ctrl+Alt+M`，右键 / 标签 / 侧边栏菜单）、切换阅读 / 源码模式、主题导入 / 选择 / 删除（主题库位于 `Packages/User/iMark`）、根据 Sublime 配色生成的 “Follow Sublime Text” 主题，以及 `browser: "app"` 以 Chromium 应用窗口打开。
- 面向非 VS Code 宿主的浏览器桥接（`dist/sublime/bridge.js`）：自动重连、显示连接状态、拦截 `Cmd/Ctrl+S`。

## 0.2.11 (2026-09-08)
- 表格恢复折行：默认（`imark.editor.tableLayout: fit`）表格最多占满可用宽度，长单元格按词折行，只有实在放不下才横向滚动；`natural` 保留此前不折行只滚动的行为。

## 0.2.10 (2026-09-08)
- 表格宽度模型优先于主题规则（例如 Monokai Syntax 会把阅读视图表格限制在 62rem 并拉伸到 100%），任何主题下阅读视图与实时预览都按自然宽度显示并在需要时滚动。

## 0.2.9 (2026-09-08)
- 表格单元格不再固定限制在 40em：只有单格宽于表格容器时才折行，关闭可读行宽后阅读视图与实时预览都会按最长行完整显示表格（整表超出视图时才滚动）。

## 0.2.8 (2026-09-08)
- 表格在实时预览中可直接可视化编辑：点击单元格编辑其 Markdown，`Tab` / `Enter` / 方向键在格间移动，末格 `Tab` 自动加行，悬停 “+” 按钮添加行列，右键菜单支持插入 / 删除行列、列对齐和进入表格源码；光标移动会跳过已渲染的表格。
- 表格按自身最长行的自然宽度布局（单元格超过 `--imark-table-cell-max-width` 才折行），宽度限制在正文列内、超出时横向滚动（`imark.editor.wideTables` 默认改为关闭）；长链接可任意断行，不再撑宽列。

## 0.2.7 (2026-09-08)
- 插件发布者改为 `PORTWAYLABS`（扩展 ID 为 `PORTWAYLABS.imark`），仓库、主页与问题反馈链接指向 github.com/sandboxgames/imark。升级后请卸载旧的 `imark.imark` 扩展。

## 0.2.6 (2026-09-08)
- 插件图标：M 改为与星芒一致的青→紫渐变填充，浅色与深色背景下均清晰可见。

## 0.2.5 (2026-09-08)
- 插件图标改为透明背景（去掉深蓝色方块，保留抗锯齿边缘）。

## 0.2.4 (2026-09-08)
- 更新插件图标（体积更小的新图标）。

## 0.2.3 (2026-09-08)
- 内置 **Monokai Syntax** 主题（作者 lat3ncy，MIT 许可）并作为默认主题；主题选择器单独列出内置主题。

## 0.2.2 (2026-09-08)
- 发布脚本（`npm run release -- <patch|minor|major|x.y.z>`）：自动升版本号、为中英文更新日志加日期、执行类型检查 / 单元测试 / VS Code 集成测试 / 生产构建、打包 VSIX 到 `release/`、提交并打 tag；可选 `--push`、`--publish`（Marketplace）与 `--github-release`。

## 0.2.1

- 表格：列宽按单词而非单个字符计算，长单元格不再挤压其他列；宽于可读行宽的表格会向两侧扩展到编辑器宽度（设置 `imark.editor.wideTables`），仍放不下时才横向滚动。

## 0.2.0

- 主题库：通过文件弹窗把 Obsidian 主题、CSS 片段和 vault 外观配置导入到 iMark 自己的 globalStorage 目录；可在命令面板中选择、删除主题和打开主题库目录。不再隐式读取 `.obsidian/themes`，主题选择保存在 VS Code 设置中。
- Mermaid：全部图表类型均可在实时预览与阅读视图中渲染（按需懒加载，跟随明暗主题）；点击图表弹出可缩放、可拖拽的预览层，并支持复制 SVG。
- 命令名称与设置说明本地化（英文、简体中文）。

## 0.1.0

- 首个版本：Live Preview / 源码 / 阅读三种模式，Obsidian 语法（Wikilink、嵌入、标签、Callout、高亮、公式、注释、frontmatter），加载 Obsidian 主题并热更新，`[[` 自动补全，图片粘贴，Typora 风格快捷键。
