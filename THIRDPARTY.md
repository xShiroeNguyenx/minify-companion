# Third-party software

Minify Companion bundles the following packages into `dist/worker.js`. Their license texts
are also collected by the bundler into `dist/worker.js.LEGAL.txt`, shipped in the extension.

| Package | Version | License | Source |
|---|---|---|---|
| terser | 5.x | BSD-2-Clause | https://github.com/terser/terser |
| clean-css | 5.x | MIT | https://github.com/clean-css/clean-css |
| html-minifier-terser | 7.x | MIT | https://github.com/terser/html-minifier-terser |
| sass (Dart Sass) | 1.99.x | MIT | https://github.com/sass/dart-sass |
| picomatch (in `dist/extension.js`) | 4.x | MIT | https://github.com/micromatch/picomatch |

And their runtime dependencies: `@jridgewell/*` (MIT), `acorn` (MIT), `source-map` (BSD-3-Clause),
`source-map-js` (BSD-3-Clause), `source-map-support` (MIT), `buffer-from` (MIT), `commander` (MIT),
`camel-case` / `param-case` / `dot-case` / `no-case` / `lower-case` / `pascal-case` (MIT), `tslib` (0BSD),
`entities` (BSD-2-Clause), `relateurl` (MIT), `immutable` (MIT), `chokidar` / `readdirp` (MIT).

`sass` 1.99 is pinned on purpose: later releases require Node 20.19, newer than the Node 18 that
VS Code 1.85 (the oldest version this extension supports) runs extensions on.
