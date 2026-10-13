# Minify Companion: Kế hoạch phát triển

Extension VS Code tự động minify file **CSS / JS / HTML**: lưu `style.css` thì `style.min.css`
được cập nhật ngay, không cần chạy build tool hay gõ lệnh.

> Trạng thái: **v0.1.0 đã code xong, chưa commit / chưa phát hành** (2026-10-13). M0–M3 gộp vào v0.1.0; còn lại xem mục 10 (ô `[~]` / `[ ]`).
>
> **Quyết định đã chốt (2026-10-13):**
> 1. Mặc định `onSave = ifMinExists`.
> 2. Theo khuôn repo `anime-companion-vscode`: publisher `shiroenguyen`, repo
>    `github.com/xShiroeNguyenx/minify-companion`, MIT, `engines.vscode ^1.85.0`, CI + release theo tag.
> 3. Source map làm **ngay v0.1.0** (setting `sourceMap`, mặc định tắt).
> 4. SCSS / Sass hỗ trợ **ngay v0.1.0** (mục 4.4).

---

## 1. Mục tiêu và phạm vi

### 1.1 Mục tiêu
1. Lưu file nguồn (`.css`, `.js`, `.mjs`, `.cjs`, `.html`, `.htm`) thì file `.min` tương ứng được
   ghi lại trong < 300 ms với file cỡ thường (< 200 KB).
2. Không bao giờ làm hỏng file `.min` đang tốt: nguồn lỗi cú pháp thì **giữ nguyên bản `.min` cũ**
   và báo lỗi rõ ràng (dòng, cột, thông điệp).
3. Cấu hình được theo workspace / thư mục, mặc định chạy ngay mà không cần cấu hình gì.
4. Chạy offline, không gửi code đi đâu, không cần Node cài sẵn trên máy (bundle hết vào `.vsix`).

### 1.2 Ngoài phạm vi (v1)
- LESS / TypeScript (cần compile, không chỉ minify). Có thể làm ở v2 (mục 11).
  SCSS / Sass **nằm trong phạm vi** v1 (mục 4.4).
- Bundle nhiều file thành một (việc của esbuild/webpack/vite).
- Chạy trên VS Code for the Web (vscode.dev): ghi file cạnh nhau qua `workspace.fs` thì được,
  nhưng chưa kiểm thử; để v2.
- Template engine (`.blade.php`, `.vue`, `.jsx`, `.twig`…): minify HTML sẽ phá cú pháp template.

---

## 2. Trải nghiệm người dùng

### 2.1 Luồng chính
```
Người dùng Ctrl+S file  assets/css/style.css
        │
        ▼
onDidSaveTextDocument ─► shouldMinify()? ──không──► bỏ qua (im lặng)
        │ có
        ▼
resolveMinPath() ─► assets/css/style.min.css
        │
        ▼
minify (worker / async) ─── lỗi ──► giữ .min cũ, status bar đỏ, Problems panel + Output
        │ ok
        ▼
nội dung giống bản cũ? ── giống ──► không ghi (tránh làm bẩn git / kích watcher)
        │ khác
        ▼
ghi atomically (file tạm + rename) ─► status bar: "$(zap) style.min.css 12.3 KB → 4.1 KB (−67%)"
```

### 2.2 Khi nào thì tự minify (quyết định cần chốt)
Setting `minifyCompanion.onSave` có 3 giá trị:

| Giá trị | Hành vi | Ghi chú |
|---|---|---|
| `ifMinExists` **(đề xuất làm mặc định)** | Chỉ cập nhật khi `.min` đã tồn tại | An toàn: mở một project lạ không bị rải file `.min` khắp nơi. Lần đầu tạo `.min` bằng lệnh / menu chuột phải |
| `always` | Luôn tạo / cập nhật `.min` | Tiện cho project nhỏ, dễ gây rác |
| `off` | Không tự chạy, chỉ chạy bằng lệnh | |

> Lý do đề xuất `ifMinExists`: đúng ý "sửa file css thì tự cập nhật file .min" (file `.min` đã có
> sẵn), đồng thời không gây bất ngờ khi mở repo có hàng trăm file JS trong đó. Nếu muốn
> `always` làm mặc định thì chỉ cần đổi 1 dòng trong `package.json`.

### 2.3 Lệnh (Command Palette, tiền tố `Minify:`)
| Lệnh | Mô tả |
|---|---|
| `Minify: Minify Current File` | Minify file đang mở (tạo `.min` nếu chưa có) |
| `Minify: Minify Selected Files` | Từ Explorer, chọn nhiều file / thư mục, chuột phải |
| `Minify: Minify All in Workspace` | Quét theo `include`/`exclude`, có progress + nút Cancel, hỏi xác nhận nếu > 50 file |
| `Minify: Toggle Auto Minify on Save` | Bật/tắt nhanh cho workspace hiện tại |
| `Minify: Show Output` | Mở Output channel "Minify Companion" |

Menu chuột phải trong Explorer và tab editor: chỉ hiện với `resourceExtname` thuộc danh sách hỗ
trợ và tên **không** kết thúc bằng `.min.*`.

### 2.4 Phản hồi
- **Status bar** (bên phải): kết quả lần chạy gần nhất, click mở Output. Màu lỗi
  (`statusBarItem.errorBackground`) khi lần chạy cuối thất bại.
- **Problems panel**: `DiagnosticCollection` riêng; lỗi cú pháp gắn đúng dòng/cột trên file nguồn,
  tự xoá khi lần lưu sau thành công.
- **Output channel**: log từng lần chạy (thời gian, kích thước trước/sau, thời gian xử lý).
- **Không** bật notification popup cho mỗi lần lưu (gây phiền). Chỉ popup khi: chạy "Minify All"
  xong, hoặc lỗi lần đầu trong phiên (kèm nút "Show Output").

---

## 3. Cấu hình (`contributes.configuration`)

| Key | Kiểu | Mặc định | Mô tả |
|---|---|---|---|
| `minifyCompanion.onSave` | enum | `ifMinExists` | Xem mục 2.2 |
| `minifyCompanion.languages` | string[] | `["css","javascript","html","scss"]` | Loại file được xử lý (`scss` gồm cả `.sass`) |
| `minifyCompanion.exclude` | string[] (glob) | `["**/node_modules/**","**/vendor/**","**/dist/**","**/*.min.*"]` | Không bao giờ xử lý |
| `minifyCompanion.outputPattern` | string | `${dir}/${name}.min.${ext}` | Đường dẫn file đích. Biến: `${dir}`, `${name}`, `${ext}`, `${workspaceFolder}`, `${relativeDir}` |
| `minifyCompanion.sourceMap` | boolean | `false` | Sinh `.map` cho JS/CSS + thêm comment `sourceMappingURL` |
| `minifyCompanion.preserveLicenseComments` | boolean | `true` | Giữ comment `/*! ... */` và `@license` |
| `minifyCompanion.js.terser` | object | `{}` | Ghi đè option Terser (`compress`, `mangle`, `format`, `ecma`…) |
| `minifyCompanion.css.cleancss` | object | `{ "level": 1 }` | Ghi đè option clean-css |
| `minifyCompanion.html.options` | object | (xem mục 4.3) | Ghi đè option html-minifier-terser |
| `minifyCompanion.scss.emitCss` | boolean | `false` | Ghi thêm `name.css` bản chưa nén khi biên dịch SCSS |
| `minifyCompanion.scss.loadPaths` | string[] | `[]` | Thư mục import thêm cho Sass (tương đối workspace folder) |
| `minifyCompanion.statusBar` | boolean | `true` | Hiện status bar item |
| `minifyCompanion.maxFileSizeKB` | number | `5120` | Bỏ qua file lớn hơn ngưỡng (báo trong Output) |

- Scope: tất cả để `resource` để cấu hình được theo từng folder trong multi-root workspace.
- Hỗ trợ **file cấu hình trong repo** `.minifyrc.json` (ưu tiên hơn settings) để cả team dùng chung:
  để **milestone 4**, không chặn v1.
- `outputPattern` phải được kiểm tra: đích **không được trùng file nguồn** và **không được nằm
  ngoài workspace folder** (chặn `../../`), nếu vi phạm thì báo lỗi cấu hình, không ghi.

---

## 4. Lựa chọn thư viện minify

Tiêu chí: **pure JavaScript** (không native binary, để một `.vsix` chạy được trên Windows/macOS/
Linux, x64/arm64), bảo trì tốt, output ổn định.

| Loại | Chọn | Lý do | Phương án bị loại |
|---|---|---|---|
| JS | **terser** | Chuẩn de-facto, ES2020+, source map, giữ license comment | `esbuild` (native binary → phải build vsix theo từng nền tảng); `uglify-js` (không hỗ trợ ES6+ đầy đủ) |
| CSS | **clean-css** | Pure JS, ổn định, html-minifier-terser cũng dùng nó → CSS trong `<style>` và file `.css` cho kết quả nhất quán | `lightningcss` (native, nhanh hơn nhưng cùng vấn đề nền tảng); `csso` (ok, có thể làm phương án dự phòng) |
| HTML | **html-minifier-terser** | Minify cả `<style>` và `<script>` inline bằng clean-css + terser | `htmlnano` (kéo theo PostCSS, nặng hơn) |

### 4.1 Option mặc định cho JS (Terser)
```jsonc
{ "compress": true, "mangle": true, "module": "<tự đoán theo .mjs / có import-export>",
  "format": { "comments": "some" /* giữ /*! và @license */ } }
```
- `.mjs` → `module: true`; `.cjs` → `module: false`; `.js` → `false` trừ khi phát hiện
  `import`/`export` ở top-level (thử parse lại khi lỗi).
- **Không** bật `unsafe*`, `toplevel` mặc định: có thể đổi hành vi code chạy trên trình duyệt
  (biến toàn cục mà script khác dùng).

### 4.2 Option mặc định cho CSS (clean-css)
- `level: 1` (an toàn). Level 2 gộp/sắp xếp lại rule, có thể đổi thứ tự cascade trong case
  hiếm, chỉ bật khi người dùng chọn.
- `rebase: false`: không viết lại `url(...)` vì file `.min` mặc định nằm cùng thư mục.
  Nếu `outputPattern` đưa file sang thư mục khác thì bật rebase theo thư mục đích (milestone 3).

### 4.3 Option mặc định cho HTML
```jsonc
{ "collapseWhitespace": true, "conservativeCollapse": true, "removeComments": true,
  "minifyCSS": true, "minifyJS": true, "removeRedundantAttributes": false,
  "keepClosingSlash": true, "ignoreCustomFragments": [ "<%[\\s\\S]*?%>", "<\\?[\\s\\S]*?\\?>", "{{[\\s\\S]*?}}" ] }
```
`conservativeCollapse` giữ 1 khoảng trắng giữa inline element, tránh dính chữ ("Hello<b>World</b>").

### 4.4 SCSS / Sass (thư viện `sass`, bản pure JS)
- `style.scss` / `style.sass` → biên dịch bằng `sass.compile(..., { style: "compressed" })` → ghi
  `style.min.css`. Sass `compressed` đã giữ `/*! ... */` và cho source map chính xác, nên không
  chạy thêm clean-css (chạy thêm sẽ phải ghép 2 source map mà lợi thêm không đáng kể).
- `minifyCompanion.scss.emitCss` (mặc định `false`): ghi thêm `style.css` bản `expanded` cạnh đó
  cho project cần cả hai.
- **Partial** (`_variables.scss`) không bao giờ sinh output. Lưu partial thì biên dịch lại các file
  entry dùng nó: extension giữ đồ thị phụ thuộc từ `loadedUrls` của mỗi lần biên dịch; partial
  chưa có trong đồ thị thì quét các file `.scss`/`.sass` không phải partial trong cùng workspace
  folder (bỏ qua `exclude`), áp đúng luật `onSave`.
- Lỗi Sass có `span.start.line/column` → diagnostic đúng vị trí, kể cả khi lỗi nằm trong partial.
- `loadPaths`: thư mục chứa file + `minifyCompanion.scss.loadPaths` (đường dẫn tương đối workspace
  folder) + `node_modules` của workspace folder.

---

## 5. Kiến trúc

### 5.1 Cấu trúc thư mục
```
minify-companion/
├─ src/
│  ├─ extension.ts            # activate/deactivate: đăng ký command, listener, status bar (mỏng)
│  ├─ core/                   # HÀM THUẦN, không import 'vscode', có unit test
│  │  ├─ paths.ts             # resolveMinPath(), isMinFile(), validateOutputPath()
│  │  ├─ paths.test.ts
│  │  ├─ filter.ts            # shouldMinify(path, config, minExists) → { ok, reason }
│  │  ├─ filter.test.ts
│  │  ├─ config.ts            # mergeConfig(defaults, settings, rc) + validate
│  │  ├─ config.test.ts
│  │  ├─ stats.ts             # formatBytes(), savingPercent()
│  │  └─ stats.test.ts
│  ├─ minifiers/              # bọc thư viện, trả về Result thống nhất, không import 'vscode'
│  │  ├─ types.ts             # MinifyResult = { ok: true, code, map? } | { ok: false, error: { message, line?, column? } }
│  │  ├─ js.ts / js.test.ts
│  │  ├─ css.ts / css.test.ts
│  │  ├─ html.ts / html.test.ts
│  │  └─ index.ts             # chọn minifier theo languageId / đuôi file
│  ├─ runtime/                # phần dính VS Code
│  │  ├─ queue.ts             # hàng đợi theo từng file (mục 5.3)
│  │  ├─ writer.ts            # ghi atomically qua workspace.fs, bỏ qua nếu nội dung giống
│  │  ├─ diagnostics.ts       # map lỗi → vscode.Diagnostic
│  │  ├─ statusBar.ts
│  │  └─ logger.ts            # OutputChannel (LogOutputChannel)
│  └─ commands/
│     ├─ minifyCurrent.ts
│     ├─ minifySelected.ts
│     ├─ minifyWorkspace.ts
│     └─ toggleAuto.ts
├─ test/
│  ├─ fixtures/               # file mẫu css/js/html (tự viết, không copy code bên thứ ba)
│  └─ integration/            # @vscode/test-electron: mở workspace mẫu, lưu file, assert .min
├─ l10n/bundle.l10n.vi.json   # chuỗi runtime tiếng Việt
├─ package.nls.json           # chuỗi tĩnh (tên lệnh, mô tả setting) tiếng Anh
├─ package.nls.vi.json        # tiếng Việt
├─ esbuild.mjs                # bundle src → dist/extension.js
├─ package.json  tsconfig.json  vitest.config.ts
├─ README.md  CHANGELOG.md  LICENSE  PLAN.md
└─ .vscodeignore
```

Nguyên tắc: `core/` và `minifiers/` **không** import `vscode` → test bằng vitest chạy nhanh,
không cần mở VS Code. `extension.ts` chỉ nối dây.

### 5.2 Lấy nội dung nguồn
Dùng `document.getText()` của `TextDocument` vừa lưu (đúng cái người dùng thấy, đã đúng
encoding), không đọc lại từ đĩa. Khi chạy từ Explorer / Minify All (file chưa mở) thì đọc qua
`workspace.fs.readFile` + `TextDecoder('utf-8')`, bỏ BOM nếu có.

### 5.3 Đồng thời và chống chạy chồng
- Hàng đợi **theo từng file nguồn**: đang minify `a.js` mà người dùng lưu tiếp thì đánh dấu
  "cần chạy lại", xong lượt hiện tại chạy đúng **một** lượt nữa với nội dung mới nhất. Không bao
  giờ để kết quả cũ ghi đè kết quả mới.
- Minify All: giới hạn song song (`os.availableParallelism() - 1`, tối thiểu 1, tối đa 4).
- File lớn (> 1 MB): chạy trong `worker_threads` để không đứng Extension Host (milestone 3;
  v1 dùng API async của terser, chấp nhận chậm với file rất lớn).

### 5.4 Ghi file an toàn
1. So sánh nội dung mới với `.min` hiện có (nếu có); **giống thì không ghi**.
2. Nếu `.min` đang mở trong editor **với thay đổi chưa lưu** → không ghi, cảnh báo trong Output
   + status bar (người dùng đang sửa tay file min, đừng đè mất).
3. Ghi `style.min.css.tmp-<random>` rồi `workspace.fs.rename(..., { overwrite: true })`.
   Rename thất bại (Windows hay khoá file khi antivirus/editor khác giữ) → thử lại 3 lần cách
   100 ms, vẫn lỗi thì xoá file tạm và báo lỗi bằng câu nói rõ nguyên nhân.
4. Giữ kết dòng: output minify là 1 dòng nên ít ảnh hưởng; file `.map` ghi `\n`.
5. Sau khi ghi, `stat` lại file đích để xác nhận kích thước khớp (API ghi file có thể "thành công"
   mà không ghi thật, ví dụ trên một số filesystem provider ảo).

### 5.5 Vòng lặp vô hạn
Lưu `.min.css` không được kích hoạt minify lại: `shouldMinify` loại mọi file khớp `*.min.*` và mọi
file trùng đường dẫn đích đã tính từ `outputPattern`. Có unit test riêng cho case này.

### 5.6 Workspace Trust
`capabilities.untrustedWorkspaces: { supported: "limited" }`: trong workspace chưa tin cậy,
**tắt tự động khi lưu**, chỉ cho chạy bằng lệnh. Lý do: setting `.vscode/settings.json` trong repo
lạ có thể đặt `outputPattern` / option kỳ quặc.

### 5.7 Activation
`activationEvents`: `onLanguage:css`, `onLanguage:javascript`, `onLanguage:html` + các command.
Không dùng `onStartupFinished` / `*` (không làm chậm khởi động VS Code).

---

## 6. Các trường hợp biên phải xử lý

| # | Trường hợp | Cách xử lý |
|---|---|---|
| 1 | Nguồn lỗi cú pháp | Giữ `.min` cũ, diagnostic đúng dòng/cột, status bar đỏ |
| 2 | File đã là `foo.min.js` | Bỏ qua (cả auto lẫn menu) |
| 3 | File rỗng | Ghi `.min` rỗng (hoặc bỏ qua nếu chưa có `.min`), không báo lỗi |
| 4 | File chỉ có comment license | Output chỉ còn comment license |
| 5 | BOM UTF-8 | Bỏ BOM trước khi minify, output không có BOM |
| 6 | CRLF | Minifier xử lý được; test fixture có cả CRLF và LF |
| 7 | JS dùng `import`/`export` trong `.js` | Tự đoán `module: true` (mục 4.1) |
| 8 | HTML có `<script type="module">`, `<script type="text/template">`, JSON-LD | Chỉ minify script JS thật; template / JSON giữ nguyên hoặc minify JSON an toàn |
| 9 | HTML có PHP / EJS / Handlebars | `ignoreCustomFragments`; đuôi `.php` không nằm trong danh sách hỗ trợ |
| 10 | `.min` đang mở và dirty | Không ghi, cảnh báo (mục 5.4) |
| 11 | `.min` bị read-only / bị khoá | Báo lỗi rõ ("file đích chỉ đọc" / "file đang bị tiến trình khác giữ") |
| 12 | Lưu liên tục (auto save `afterDelay`) | Hàng đợi theo file (mục 5.3) đảm bảo không chạy chồng |
| 13 | Multi-root workspace | Đọc config theo `resource`, `${workspaceFolder}` là folder chứa file |
| 14 | File ngoài workspace (mở lẻ) | Vẫn chạy được với `${dir}`; `${workspaceFolder}` → lỗi cấu hình rõ ràng |
| 15 | Đổi tên / xoá file nguồn | v1: không động vào `.min` (không tự xoá file người dùng). Ghi nhận cho v2 |
| 16 | `git checkout` đổi nguồn mà không lưu trong editor | v1: không tự chạy (chỉ nghe sự kiện lưu). Có thể thêm watcher tuỳ chọn ở v2 |
| 17 | Remote (SSH / WSL / Dev Container) | Dùng `workspace.fs` + `Uri` (không dùng `fs` của Node trực tiếp) để chạy đúng phía remote; khai `extensionKind: ["workspace"]` |

---

## 7. Hiệu năng

- Bundle bằng esbuild, `minify: true`, external chỉ `vscode` → 1 file `dist/extension.js`.
  Ước lượng kích thước sau bundle: terser ~1 MB, clean-css ~0.4 MB, html-minifier-terser ~0.2 MB.
- **Lazy-load minifier**: `await import('./minifiers/js')` lần đầu cần → kích hoạt extension không
  phải nạp cả 3 thư viện. (esbuild cần `splitting` + `format: esm`, hoặc tách 3 entry riêng.)
- Mục tiêu đo: lưu file CSS 50 KB → `.min` được ghi < 150 ms trên máy dev; JS 200 KB < 500 ms.
  Đo bằng log thời gian trong Output, ghi số thực tế vào CHANGELOG khi release.

---

## 8. Kiểm thử

### 8.1 Unit test (vitest, đặt cạnh file nguồn `*.test.ts`)
- `paths`: mọi biến của `outputPattern`, đường dẫn Windows (`path.win32`) và POSIX, chặn `..`
  thoát workspace, chặn đích trùng nguồn.
- `filter`: `*.min.*`, glob exclude, `ifMinExists` khi có/không có file, giới hạn kích thước,
  workspace untrusted.
- `config`: merge default ← settings ← `.minifyrc.json`, giá trị sai kiểu bị loại kèm cảnh báo.
- `minifiers`: fixture đầu vào → output mong đợi; lỗi cú pháp trả về đúng `line`/`column`;
  license comment được giữ; `module` tự đoán đúng.
- **Kiểm tra tương đương hành vi** cho JS: chạy fixture gốc và bản min trong `node:vm`, so kết quả.

### 8.2 Integration test (`@vscode/test-electron`)
- Mở workspace mẫu, sửa + lưu `style.css` → assert `style.min.css` có nội dung mong đợi.
- Lưu file lỗi → `.min` không đổi, có diagnostic.
- Lưu 5 lần liên tiếp nhanh → nội dung cuối cùng khớp lần lưu cuối.
- `onSave: ifMinExists` khi chưa có `.min` → không tạo file.

### 8.3 Kiểm thử tay trước mỗi release (checklist)
- [ ] Windows + 1 OS khác (hoặc CI) cài `.vsix` thật, lưu file css/js/html.
- [ ] Remote WSL hoặc SSH: file `.min` xuất hiện ở phía remote.
- [ ] Multi-root workspace với 2 cấu hình khác nhau.
- [ ] Workspace untrusted: auto tắt, lệnh tay vẫn chạy.
- [ ] Giao diện tiếng Việt (`"locale": "vi"`) hiện đúng chuỗi.

### 8.4 Cổng chất lượng
`npm run typecheck` + `npm test` + `npm run build` + `npx vsce package` đều xanh mới release.

---

## 9. Đa ngôn ngữ (i18n)
- Chuỗi tĩnh trong `package.json` dùng `%key%` → `package.nls.json` (en) + `package.nls.vi.json`.
- Chuỗi runtime dùng `vscode.l10n.t(...)` → `l10n/bundle.l10n.vi.json`.
- Thêm khoá cho **cả hai** ngôn ngữ cùng lúc trong mỗi thay đổi.

---

## 10. Lộ trình (milestones)

### M0: Khung dự án (≈ 0.5 ngày)
- [x] `npm init`, TypeScript strict, esbuild, vitest, ESLint.
- [x] `package.json`: `engines.vscode ^1.85.0`, activation events, `extensionKind`, `capabilities`.
- [x] Script: `build`, `watch`, `typecheck`, `test`, `test:integration`, `package`.
- [x] `.vscodeignore` chỉ ship `dist/`, `package.nls*.json`, `l10n/`, README, CHANGELOG, LICENSE, THIRDPARTY.
- [x] Launch config F5 (Extension Development Host).

### M1: Lõi minify (≈ 1.5 ngày) → **v0.1.0**
- [x] `core/paths`, `core/filter`, `core/stats` + test.
- [x] `minifiers/js|css|html|scss` với Result thống nhất + test fixture.
- [x] Source map JS / CSS / SCSS (kéo lên từ M3).
- [x] Đồ thị phụ thuộc SCSS: lưu partial → biên dịch lại entry (mục 4.4).
- [x] Lệnh `Minify: Minify Current File`.
- [x] Ghi file atomically, bỏ qua khi nội dung giống.

### M2: Tự động khi lưu (≈ 1 ngày) → **v0.2.0**
- [x] `onDidSaveTextDocument` + `onSave` 3 chế độ.
- [x] Hàng đợi theo file, chống vòng lặp `.min`.
- [x] Status bar, Output channel, Diagnostics.
- [x] Workspace Trust.
- [x] Integration test cho luồng lưu.

### M3: Hoàn thiện (≈ 1.5 ngày) → **v0.3.0**
- [x] Menu Explorer / editor title, `Minify Selected Files`, `Minify All in Workspace` (progress, cancel, xác nhận).
- [x] `outputPattern` đầy đủ biến + rebase URL CSS khi đổi thư mục.
- [~] Lazy-load minifier: **xong** (dynamic import). Worker thread cho file lớn: **chưa làm** (v0.1.0 dùng API async; file vài MB có thể làm Extension Host khựng một chút).
- [x] i18n en + vi.

### M4: Cấu hình nhóm và phát hành (≈ 1 ngày) → **v1.0.0**
- [ ] `.minifyrc.json` (+ JSON schema qua `contributes.jsonValidation` để có gợi ý khi gõ).
- [~] README có bảng setting, FAQ (xong); GIF demo (chưa có) ("vì sao không tạo .min?" → giải thích `ifMinExists`).
- [x] `keywords`, `categories`, icon (`media/icon.png`, 256×256), `galleryBanner` (nền đen, theme dark).
- [x] CI GitHub Actions: matrix Windows / macOS / Ubuntu chạy typecheck + test + build + package;
      job publish chạy khi push tag `v*` (VS Marketplace qua `VSCE_PAT`, Open VSX qua `OVSX_PAT`,
      token lưu trong GitHub Secrets, không bao giờ nằm trong repo).
- [x] `THIRDPARTY.md` liệt kê license của terser (BSD-2), clean-css (MIT), html-minifier-terser (MIT).

**Tổng ước lượng: ~5.5 ngày công.**

---

## 11. Ý tưởng cho v2 (chưa cam kết)
- SCSS/LESS → CSS → min (dùng `sass` bản pure JS).
- Watcher tuỳ chọn cho thay đổi ngoài editor (git checkout, tool khác ghi file).
- Tự xoá / đổi tên `.min` khi nguồn bị xoá / đổi tên (có hỏi xác nhận).
- Minify JSON / SVG.
- CodeLens / hover trên đầu file hiện "min: 4.1 KB (−67%)".
- Chạy trên VS Code for the Web.
- So sánh gzip/brotli size trong status bar.

---

## 12. Rủi ro

| Rủi ro | Ảnh hưởng | Giảm thiểu |
|---|---|---|
| Minify làm đổi hành vi JS (biến toàn cục, `eval`, `Function.name`) | Lỗi production khó tìm | Option an toàn mặc định, không `toplevel`/`unsafe`; test tương đương bằng `node:vm` |
| Minify HTML phá template server-side | Trang hỏng | Không hỗ trợ đuôi template; `ignoreCustomFragments`; `conservativeCollapse` |
| Ghi đè `.min` người dùng sửa tay | Mất dữ liệu | Không ghi khi `.min` dirty; README nói rõ `.min` là file sinh ra |
| Bundle to làm chậm kích hoạt | Trải nghiệm kém | Activation theo ngôn ngữ + lazy-load |
| Thư viện có lỗ hổng / ngừng bảo trì | Bảo mật | `npm audit` trong CI, Dependabot, lớp `minifiers/` tách biệt để thay thư viện dễ |
| Xung đột với extension khác cùng chức năng (Live Sass, Minify…) | Ghi chồng file | README hướng dẫn tắt một bên; ghi atomically giảm file hỏng |

---

## 13. Quyết định
Đã chốt ngày 2026-10-13, xem đầu file. Sau khi chốt, các mục **source map** và **SCSS** được kéo lên
làm cùng M1–M2 (bản v0.1.0), thay vì M3 / v2 như dự kiến ban đầu.
