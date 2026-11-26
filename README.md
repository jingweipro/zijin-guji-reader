# 子衿古籍阅读器 | Zijin Guji Reader

免费、无需账户的古籍竖排阅读器。公益站：https://guji.wuyunliuqi.top/ 。

Free, local-first classical Chinese reader with vertical typography, full-text search, bookmarks, notes, export and sharing. No database or backend is required.

## 自建 / Self-host
安装 Node.js 22.4+ 与 Python 3（仅本地测试服务器）。没有 npm 运行依赖。

```sh
git clone https://github.com/jingweipro/zijin-guji-reader.git
git clone https://github.com/jingweipro/zijin-guji-data.git
git clone https://github.com/jingweipro/zijin-guji-noncommercial.git
cd zijin-guji-reader
npm run build -- dist ../zijin-guji-data ../zijin-guji-noncommercial
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

访问 http://127.0.0.1:8765/ 。只使用可商用许可的数据时，可省略最后一个数据仓库参数。只构建《千字文》可添加 `--book qianziwen`。输出目录必须不存在，以防误覆盖已有网站。正式托管可上传 dist 的静态文件到支持 HTTPS 的平台；无需连接官方站。使用受信任的、经过授权的数据集，保留来源及许可证；构建检查数据摘要并排除未分发的对校文本。

Build from trusted, licensed data repositories. Choose the 31-book open-data set alone or add the 19-book noncommercial collection only for compatible use. Serve the generated directory over HTTPS or localhost. Reader state is local to the browser; export a backup before changing origins.

## 许可 / License

原创阅读器及构建代码采用 GNU AGPL-3.0-only，见 LICENSE。ICU 转换数据与字体保留各自许可证，见 THIRD_PARTY_NOTICES.md。古籍内容不受软件许可证覆盖；每部古籍保留原始署名和许可。非商业数据不得用于商业用途。本项目不对公有领域古籍原文主张专有权利。

## 测试 / Tests

```sh
npm test
npm run build -- demo ../zijin-guji-data --book qianziwen
npm run test:browser -- demo
```

浏览器测试需要 Chrome/Chromium（可设置 CHROME 路径）。
