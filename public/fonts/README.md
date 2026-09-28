# 中文展示字体

字体：Noto Sans SC，400 / 500。通过 Google Fonts 官方 CSS API 按当前 H1/H2/状态标题字符提取字形子集，保留约 10 KB/字重的 TrueType 文件，网页自托管加载。

- 授权：SIL Open Font License 1.1，见 `OFL.txt`。
- 官方来源与确切字形请求：`source-url.txt`。
- 官方响应及字体二进制来源：`source.css.txt`。
- 提取日期：2026-09-11。
- 运行时无 Google Fonts 网络请求。

更新中文标题时需同步字形子集，避免新增字形回退。正文使用本地系统中文字体；Latin 使用 `@fontsource/manrope`。
