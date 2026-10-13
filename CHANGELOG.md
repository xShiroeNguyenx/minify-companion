# Changelog

Tài liệu này theo format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
extension áp dụng [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-13

### Added — ⚡ First release

- **Minify on save** for CSS, JavaScript (`.js` / `.mjs` / `.cjs`) and HTML, writing `name.min.ext` next to the source ([src/runtime/engine.ts](src/runtime/engine.ts)).
  - **By default, a save only updates a `.min` file that already exists** (`minifyCompanion.onSave: "ifMinExists"`), so opening a project never scatters new files around it. `always` creates them on every save; `off` leaves only the commands.
  - **A syntax error never replaces a working `.min` file.** The old one stays, and the error is shown in the Problems panel at its line and column, then cleared by the next good save.
  - **Unchanged output is not written**, so a save with no real change does not touch the `.min` file or show up in git. Output is written to a temp file and renamed over the target, so a half-written `.min` file cannot happen.
  - **A `.min` file open with unsaved edits is not overwritten.**
  - **Quick successive saves cannot race**: at most one minify per file runs at a time, and the last save always wins.
- **SCSS / Sass**: `.scss` and `.sass` compile to `name.min.css`. Saving a partial recompiles every entry that uses it, learnt from each compile; errors inside a partial are shown in the partial. `minifyCompanion.scss.emitCss` also writes the uncompressed `name.css` ([src/minifiers/scss.ts](src/minifiers/scss.ts)).
- **Source maps** for JS, CSS and Sass with `minifyCompanion.sourceMap` (off by default), with sources recorded relative to the map.
- **Commands**: Minify Current File, Minify (Explorer, for files and folders), Minify All in Workspace (asks first above 50 files, can be cancelled), Toggle Minify on Save, Show Output. The status bar shows the last result.
- **Safe defaults**: license comments kept; top-level names of classic scripts not mangled; CSS `@import` kept as written rather than inlined; clean-css's silent dropping of unparsable CSS treated as an error; PHP / EJS / mustache tags in HTML left alone.
- **`minifyCompanion.outputPattern`** with `${dir}`, `${name}`, `${ext}`, `${workspaceFolder}`, `${relativeDir}`. Targets outside the workspace folder, or equal to the source, are refused; CSS `url(...)` is rebased when the output moves folder.
- **Untrusted workspaces**: minify on save is off and the settings that choose paths or minifier options are ignored; commands still work.
- English and Vietnamese UI.
