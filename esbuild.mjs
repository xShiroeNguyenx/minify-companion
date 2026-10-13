// Bundles src/extension.ts and every runtime dependency into dist/extension.js,
// so the .vsix ships no node_modules. `vscode` is provided by the host.
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  // VS Code 1.85 runs on Electron 25 / Node 18.
  target: 'node18',
  outfile: 'dist/extension.js',
  // sass only needs @parcel/watcher for `sass --watch`, which we never call.
  external: ['vscode', '@parcel/watcher'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  legalComments: 'external',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
