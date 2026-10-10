# 扬斯克城 Wiki

正文维护在 `source/` 中。生成器递归读取 Markdown，将相对路径转换为静态 HTML，并自动生成导航、当前页标记、本页目录和章节翻页链接。

在本目录运行：

```sh
npm install
npm run build
npm run preview
```

预览地址是 `http://127.0.0.1:8010/`。如端口已被占用，使用 `npm run preview -- --port 8011`。修改 Markdown 后重新运行 `npm run build`，再刷新网页。

| 源文件 | 生成页面 |
| --- | --- |
| `source/index.md` | `index.html` |
| `source/geography.md` | `pages/geography.html` |
| `source/科技/光能.md` | `pages/科技/光能.html` |
| `source/科技/index.md` | `pages/科技/index.html` |

一个 Markdown 文件对应一个页面。网页标题取文件中的第一个标题；没有标题时使用文件名。子目录保持原样，中文名称与空格也可使用。Markdown 表格、引用、列表、代码块和强调会正常渲染；生成器不改写正文。

在 Markdown 中使用相对链接，例如 `[光能](科技/光能.md#共振结)`、`![剖面](images/剖面.png)`。生成器会将 `.md` 链接转换为 HTML 链接，将附件和 Markdown 原文件逐字节复制到 `assets/source/`，并修正各层级页面的资源路径。缺少链接目标或路径越过源目录时，构建会指出对应文件。

`wiki.config.json` 设置站点名称、版本、首页及导航顺序。`navigation` 中的 `source` 是相对于 `source/` 的文件路径，`label` 可覆盖导航显示名称，`id` 可保留旧的章节标识。新增 Markdown 会自动加入导航；需要指定位置时，将它加入 `navigation`。

```json
{
  "title": "扬斯克城世界观",
  "version": "v4.0beta",
  "home": "index.md",
  "navigation": [
    { "source": "index.md", "label": "总纲", "id": "overview" },
    { "source": "科技/光能.md", "label": "光能科技" }
  ]
}
```

也可以直接运行 `node scripts/build.mjs`，或使用 `--source`、`--root`、`--config` 指定输入目录、项目目录与配置。运行 `node scripts/build.mjs --help` 查看用法。未设置首页且没有 `source/index.md` 时，生成器自动创建章节目录首页。

生成器通过 `.wiki-generated.json` 记录产物。删除或移动 Markdown 后，下次构建会清理其旧产物；若该文件在 `navigation` 中显式配置，也需同步更新配置。手工页面和样式不在清理范围内。正文应修改 `source/` 中的 Markdown。若已生成的文件被手工修改，构建会报告冲突并停止，请先将需保留的修改移回源文件，再恢复对应产物。

```sh
npm test
```

测试涵盖多层路径、中文链接、附件、导航、重复生成以及删除源文件后的清理行为。
