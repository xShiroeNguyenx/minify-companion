# ⚡ Minify Companion for VS Code

> **Language**: **English** · [Tiếng Việt](docs/README.vi.md)

Edit `style.css`, press <kbd>Ctrl</kbd>+<kbd>S</kbd>, and `style.min.css` is up to date. No build tool, no terminal, no config.

Minify Companion minifies **CSS, JavaScript and HTML** and compiles **SCSS / Sass** every time you save, writing the result next to the source. It runs entirely inside VS Code, offline, and never sends your code anywhere.

**Current version:** v0.1.1

## Features

- **Minify on save** for `.css`, `.js` / `.mjs` / `.cjs`, `.html` / `.htm`, `.scss` / `.sass`.
- **Never breaks a working `.min` file**: if the source has a syntax error, the old `.min` stays as it was and the error appears in the Problems panel at the right line and column.
- **SCSS / Sass**: compiles to `name.min.css`. Saving a partial (`_variables.scss`) recompiles every file that `@use`s it. It can also write the uncompressed `name.css`.
- **Source maps** for JS, CSS and Sass (off by default; one setting turns them on).
- **License comments kept**: `/*! … */`, `@license`, and `<!--! … -->` in HTML.
- **Safe defaults**: top-level names of classic scripts are not renamed (other `<script>` tags may use them), CSS `@import` stays as written, template tags (`<?php ?>`, `<% %>`, `{{ }}`) in HTML are left alone.
- **Only writes when something changed**, so saving without a real change does not touch the `.min` file or show up in git.
- Works in multi-root workspaces and over Remote SSH / WSL / Dev Containers.

## How it decides what to minify

By default (`minifyCompanion.onSave: "ifMinExists"`) a save **only updates a `.min` file that already exists**. Opening someone else's project therefore never scatters new `.min` files around it.

To start minifying a file, create its `.min` once:

- **Command Palette** → `Minify: Minify Current File`, or
- **Right-click** the file (in the Explorer, the editor or its tab) → **Minify**, or
- **Right-click a folder** → **Minify** to do every supported file in it, or
- `Minify: Minify All in Workspace`.

From then on, every save keeps it up to date. If you want every save to create the `.min` file, set `"minifyCompanion.onSave": "always"`.

Files named `*.min.*` and Sass partials (`_*.scss`) are never treated as sources.

## Commands

| Command | What it does |
|---|---|
| `Minify: Minify Current File` | Minify the active file and create its `.min` if needed |
| `Minify` (Explorer right-click) | Minify the selected files, or every supported file in the selected folders |
| `Minify: Minify All in Workspace` | Minify every supported file (asks first above 50 files; can be cancelled) |
| `Minify: Toggle Minify on Save` | Turn minify on save off or back on for this workspace |
| `Minify: Show Output` | Open the log: sizes, timings, errors |

The status bar shows the last result (`⚡ style.min.css −67%`); click it to open the log.

## Settings

| Setting | Default | Description |
|---|---|---|
| `minifyCompanion.onSave` | `ifMinExists` | `ifMinExists`, `always` or `off` |
| `minifyCompanion.languages` | all four | Which of `css`, `javascript`, `html`, `scss` are handled on save and by folder commands |
| `minifyCompanion.exclude` | `node_modules`, `vendor`, `dist`, `*.min.*` | Globs never minified on save or by folder commands |
| `minifyCompanion.outputPattern` | `${dir}/${name}.min.${ext}` | Where the output goes. Variables: `${dir}` `${name}` `${ext}` `${workspaceFolder}` `${relativeDir}` |
| `minifyCompanion.sourceMap` | `false` | Write `.map` files |
| `minifyCompanion.preserveLicenseComments` | `true` | Keep `/*! */` and `@license` comments |
| `minifyCompanion.js.terser` | `{}` | [Terser options](https://terser.org/docs/options/) merged over the defaults |
| `minifyCompanion.css.cleancss` | `{ "level": 1 }` | [clean-css options](https://github.com/clean-css/clean-css#constructor-options) |
| `minifyCompanion.html.options` | `{}` | [html-minifier-terser options](https://github.com/terser/html-minifier-terser#options-quick-reference) merged over the safe defaults |
| `minifyCompanion.scss.emitCss` | `false` | Also write the uncompressed `name.css` |
| `minifyCompanion.scss.loadPaths` | `[]` | Extra folders for Sass `@use` / `@import` (relative to the workspace folder) |
| `minifyCompanion.statusBar` | `true` | Show the last result in the status bar |
| `minifyCompanion.maxFileSizeKB` | `5120` | Skip larger files |

Example: put every minified file under `public/`, mirroring the source tree:

```jsonc
"minifyCompanion.outputPattern": "${workspaceFolder}/public/${relativeDir}/${name}.min.${ext}"
```

When the output lands in another folder, relative `url(...)` in CSS is rewritten to still point at the same files. A pattern that would write outside the workspace folder, or over the source itself, is refused.

## FAQ

**I saved and no `.min` file appeared.** That is the default `ifMinExists` mode: create it once with `Minify: Minify Current File`, or switch to `"always"`.

**I saved and the `.min` file did not change.** Check the Problems panel and `Minify: Show Output`. A syntax error keeps the previous `.min` file on purpose. If you have the `.min` file open with unsaved edits, it is not overwritten either.

**My `.min` file has hand edits.** It is a generated file: the next save replaces it. Keep hand-written code in the source.

**Does it bundle files?** No. Each source produces one output, and `@import` / `import` stay as written. Use esbuild, Vite or webpack for bundling.

**Untrusted workspace?** Minify on save stays off and settings that choose output paths or minifier options are ignored until you trust the folder. The Minify commands still work.

## Credits

Built on [Terser](https://github.com/terser/terser), [clean-css](https://github.com/clean-css/clean-css), [html-minifier-terser](https://github.com/terser/html-minifier-terser) and [Dart Sass](https://github.com/sass/dart-sass). See [THIRDPARTY.md](THIRDPARTY.md).

## License

[MIT](LICENSE)
