# Changelog

Tài liệu này theo format [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
extension áp dụng [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-13

### Changed — ⚡ Minifying no longer freezes the editor

- **Minifying now runs in worker threads, so a large file never blocks VS Code.** Terser is synchronous CPU work: about 1.3 s for 360 KB of JavaScript, during which the extension host — and with it every other extension, and the save itself — used to stand still. The work now happens in a small pool of reusable workers (at most one per spare CPU core, up to 4), started on demand and stopped after two idle minutes ([src/core/workerPool.ts](src/core/workerPool.ts), [src/worker.ts](src/worker.ts)).
  - **Verified in VS Code 1.85**: while a 361 KB file is minified (about 2 s), the extension host never stalls more than 300 ms.
  - **A worker that crashes, or a job that runs past 60 s, fails with a message saying so** and the next save gets a fresh worker; the existing `.min` file is left untouched.
  - **Activation is lighter**: `extension.js` went from 4 MB to 45 KB, because the minifier libraries now live only in `worker.js`.
- **Measured on a development machine** (minify time only): CSS 80 KB → 149 ms; JavaScript 356 KB → 1.26 s. In VS Code, the first run after start-up adds about a second while the worker loads.

### Added

- **The first failed save of a session pops up**, with a **Show Output** button. Later failures stay in the status bar and the Problems panel, so a file saved repeatedly while you fix it does not nag ([src/runtime/engine.ts](src/runtime/engine.ts)).

### Fixed

- **With a custom `outputPattern`, the outputs are no longer minified again.** With `"${workspaceFolder}/out/${relativeDir}/${name}.${ext}"`, *Minify All in Workspace* used to treat `out/css/a.css` as a source and write `out/out/css/a.css`, one level deeper on every run. A file that has the shape of an output under the current pattern is now always skipped ([src/core/paths.ts](src/core/paths.ts)).
- **Settings that hold objects (`js.terser`, `css.cleancss`, `html.options`) are copied to plain data** before use; VS Code hands them out as read-only proxies ([src/core/config.ts](src/core/config.ts)).
- **A script mistaken for an ES module is retried as a script.** The module guess is a pattern match. When it misfired (for example, `export default` at the start of a line inside a template string), strict-mode rules rejected valid legacy code such as `with` statements. An explicit `module` in `minifyCompanion.js.terser` is still honoured as given ([src/minifiers/js.ts](src/minifiers/js.ts)).
- **`<script type="text/template">` and other non-JavaScript scripts are kept exactly as written.** Whitespace around `{{ … }}` inside them used to be collapsed ([src/minifiers/html.ts](src/minifiers/html.ts)).

### Internal

- **CI**: `npm audit` of the runtime dependencies on every build; Dependabot for npm and GitHub Actions, told never to propose sass 1.100+ (it requires Node 20.19).
- **New tests**: empty files, license-only files, CRLF line endings, module-guess fallback, template scripts, the worker pool (crash, timeout, idle shutdown), and integration tests for *Minify All*, the folder context menu, *Toggle Minify on Save*, custom output folders, and the non-blocking large file.

## [0.1.1] - 2026-10-13

### Fixed — Sass in folders opened through a short (8.3) Windows path

- **Sass source maps, partial errors and partial recompiles now work when the project's path uses a Windows 8.3 short name** (`C:\Users\LONGNA~1\...`). Sass corrects the spelling of every file it loads to the long name on disk, while the editor keeps the spelling you opened. The two never matched, which caused three problems ([src/minifiers/scss.ts](src/minifiers/scss.ts)):
  - **Map sources pointed at the wrong place.** They read like `../../../../longname/.../_vars.scss` instead of `_vars.scss`, so browser devtools could not find the source.
  - **An error inside a partial was reported against a file the editor did not have open**, so the open partial showed nothing in the Problems panel.
  - **Saving a partial did not find its entries in the dependency graph** and fell back to recompiling every Sass entry in the folder.
- Every path Sass reports is now mapped back onto the spelling of the source's own folder.
- **CI**: GitHub Actions moved to `actions/checkout@v5`, `actions/setup-node@v5` and `actions/upload-artifact@v5`, which run on Node 24 instead of the deprecated Node 20.

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
