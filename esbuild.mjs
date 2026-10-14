// Bundles into dist/ so the .vsix ships no node_modules. `vscode` is provided by the host.
// - extension.js: the extension itself, small; never loads a minifier.
// - worker.js: terser, clean-css, html-minifier-terser and sass, run in worker threads.
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts', 'src/worker.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // VS Code 1.85 runs on Electron 25 / Node 18.
  target: 'node18',
  outdir: 'dist',
  // sass only needs @parcel/watcher for `sass --watch`, which we never call.
  external: ['vscode', '@parcel/watcher'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  legalComments: 'external',
  logLevel: 'info',
});

// - settings.js: the script of the settings webview, which runs in a browser page.
const webview = await esbuild.context({
  entryPoints: ['src/webview/settings.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outdir: 'dist',
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
});

if (watch) {
  await Promise.all([ctx.watch(), webview.watch()]);
} else {
  await Promise.all([ctx.rebuild(), webview.rebuild()]);
  await Promise.all([ctx.dispose(), webview.dispose()]);
}
