# ⚡ Minify Companion cho VS Code

> **Ngôn ngữ**: [English](../README.md) · **Tiếng Việt**

Sửa `style.css`, bấm <kbd>Ctrl</kbd>+<kbd>S</kbd>, `style.min.css` đã được cập nhật. Không cần build tool, không cần terminal, không cần cấu hình.

Minify Companion minify **CSS, JavaScript, HTML** và biên dịch **SCSS / Sass** mỗi lần bạn lưu, ghi kết quả ngay cạnh file nguồn. Mọi thứ chạy trong VS Code, offline, không gửi code đi đâu.

**Phiên bản hiện tại:** v0.2.0

## Tính năng

- **Minify khi lưu** cho `.css`, `.js` / `.mjs` / `.cjs`, `.html` / `.htm`, `.scss` / `.sass`.
- **Không bao giờ làm hỏng file `.min` đang chạy tốt**: nguồn lỗi cú pháp thì `.min` cũ được giữ nguyên, lỗi hiện trong Problems đúng dòng, đúng cột.
- **SCSS / Sass**: biên dịch ra `name.min.css`. Lưu partial (`_variables.scss`) thì mọi file `@use` nó được biên dịch lại. Có thể ghi thêm `name.css` chưa nén.
- **Source map** cho JS, CSS, Sass (mặc định tắt, bật bằng một setting).
- **Giữ comment license**: `/*! … */`, `@license`, và `<!--! … -->` trong HTML.
- **Mặc định an toàn**: không đổi tên biến top-level của script thường (`<script>` khác có thể đang dùng), giữ nguyên `@import` trong CSS, không đụng vào thẻ template (`<?php ?>`, `<% %>`, `{{ }}`) trong HTML.
- **Chỉ ghi khi có thay đổi**: lưu mà nội dung không đổi thì file `.min` không bị chạm tới, không hiện trong git.
- Setting có thể khác nhau theo từng thư mục trong multi-root workspace.
- Minify chạy trong worker thread nền, nên file lớn cũng không làm editor bị đứng.

## Cách nó quyết định minify file nào

Mặc định (`minifyCompanion.onSave: "ifMinExists"`), lưu file **chỉ cập nhật file `.min` đã có sẵn**. Nhờ vậy mở project của người khác không bị rải file `.min` khắp nơi.

Để bắt đầu minify một file, tạo `.min` của nó một lần:

- **Command Palette** → `Minify: Minify file hiện tại`, hoặc
- **Chuột phải** vào file (trong Explorer, trong editor hoặc trên tab) → **Minify**, hoặc
- **Chuột phải vào thư mục** → **Minify** để làm mọi file được hỗ trợ bên trong, hoặc
- `Minify: Minify toàn bộ workspace`.

Từ đó về sau, mỗi lần lưu sẽ giữ nó luôn mới. Muốn lần lưu nào cũng tạo file `.min` thì đặt `"minifyCompanion.onSave": "always"`.

File tên `*.min.*` và Sass partial (`_*.scss`) không bao giờ được coi là file nguồn.

## Lệnh

| Lệnh | Tác dụng |
|---|---|
| `Minify: Minify file hiện tại` | Minify file đang mở, tạo `.min` nếu chưa có |
| `Minify` (chuột phải trong Explorer) | Minify các file đã chọn, hoặc mọi file được hỗ trợ trong thư mục đã chọn |
| `Minify: Minify toàn bộ workspace` | Minify mọi file được hỗ trợ (hỏi trước nếu hơn 50 file; huỷ được) |
| `Minify: Bật/tắt minify khi lưu` | Tắt hoặc bật lại minify khi lưu cho workspace này |
| `Minify: Mở Output` | Mở log: kích thước, thời gian, lỗi |

Thanh trạng thái hiện kết quả gần nhất (`⚡ style.min.css −67%`), bấm vào để mở log.

## Cài đặt

| Setting | Mặc định | Mô tả |
|---|---|---|
| `minifyCompanion.onSave` | `ifMinExists` | `ifMinExists`, `always` hoặc `off` |
| `minifyCompanion.languages` | cả bốn | Loại nào trong `css`, `javascript`, `html`, `scss` được xử lý khi lưu và bởi lệnh thư mục |
| `minifyCompanion.exclude` | `node_modules`, `vendor`, `dist`, `*.min.*` | Glob không bao giờ minify khi lưu hoặc bởi lệnh thư mục |
| `minifyCompanion.outputPattern` | `${dir}/${name}.min.${ext}` | Nơi ghi file đích. Biến: `${dir}` `${name}` `${ext}` `${workspaceFolder}` `${relativeDir}` |
| `minifyCompanion.sourceMap` | `false` | Ghi file `.map` |
| `minifyCompanion.preserveLicenseComments` | `true` | Giữ comment `/*! */` và `@license` |
| `minifyCompanion.js.terser` | `{}` | [Option Terser](https://terser.org/docs/options/) ghi đè lên mặc định |
| `minifyCompanion.css.cleancss` | `{ "level": 1 }` | [Option clean-css](https://github.com/clean-css/clean-css#constructor-options) |
| `minifyCompanion.html.options` | `{}` | [Option html-minifier-terser](https://github.com/terser/html-minifier-terser#options-quick-reference) ghi đè lên bộ mặc định an toàn |
| `minifyCompanion.scss.emitCss` | `false` | Ghi thêm `name.css` chưa nén |
| `minifyCompanion.scss.loadPaths` | `[]` | Thư mục thêm cho Sass `@use` / `@import` (tương đối workspace folder) |
| `minifyCompanion.statusBar` | `true` | Hiện kết quả gần nhất trên thanh trạng thái |
| `minifyCompanion.maxFileSizeKB` | `5120` | Bỏ qua file lớn hơn |

Ví dụ: đặt mọi file đã minify vào `public/`, giữ nguyên cấu trúc thư mục nguồn:

```jsonc
"minifyCompanion.outputPattern": "${workspaceFolder}/public/${relativeDir}/${name}.min.${ext}"
```

Khi file đích nằm ở thư mục khác, `url(...)` tương đối trong CSS được viết lại để vẫn trỏ đúng file. Pattern dẫn ra ngoài workspace folder, hoặc ghi đè chính file nguồn, sẽ bị từ chối.

## Hỏi đáp

**Lưu rồi mà không thấy file `.min`.** Đó là chế độ mặc định `ifMinExists`: tạo nó một lần bằng `Minify: Minify file hiện tại`, hoặc chuyển sang `"always"`.

**Lưu rồi mà file `.min` không đổi.** Xem Problems và `Minify: Mở Output`. Lỗi cú pháp sẽ giữ nguyên file `.min` cũ, đây là chủ ý. Nếu bạn đang mở file `.min` với thay đổi chưa lưu, nó cũng không bị ghi đè.

**File `.min` của tôi có sửa tay.** Đó là file sinh ra: lần lưu sau sẽ thay nó. Hãy để code viết tay trong file nguồn.

**Có gộp (bundle) file không?** Không. Mỗi file nguồn cho ra một file đích, `@import` / `import` giữ nguyên. Cần bundle thì dùng esbuild, Vite hoặc webpack.

**Workspace chưa tin cậy?** Minify khi lưu tắt, các setting chọn đường dẫn đích hay option minifier bị bỏ qua cho tới khi bạn tin cậy thư mục. Các lệnh Minify vẫn dùng được.

## Ghi công

Xây trên [Terser](https://github.com/terser/terser), [clean-css](https://github.com/clean-css/clean-css), [html-minifier-terser](https://github.com/terser/html-minifier-terser) và [Dart Sass](https://github.com/sass/dart-sass). Xem [THIRDPARTY.md](../THIRDPARTY.md).

## Giấy phép

[MIT](../LICENSE)
