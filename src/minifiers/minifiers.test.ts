import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import { toPosix } from '../core/paths';
import type { MinifyConfig, MinifyInput, MinifyResult } from '../core/types';
import { buildCleanCssOptions, minifyCss } from './css';
import { minifyHtml } from './html';
import { detectModule, minifyJs } from './js';
import { runMinifier } from './index';
import { minifyScss } from './scss';

function inp(srcPath: string, code: string, config: Partial<MinifyConfig> = {}, outPath?: string): MinifyInput {
  const ext = srcPath.endsWith('.scss') || srcPath.endsWith('.sass') ? 'css' : path.posix.extname(srcPath).slice(1);
  const out = outPath ?? srcPath.replace(/\.[^.]+$/, `.min.${ext}`);
  return { code, srcPath, outPath: out, config: { ...DEFAULT_CONFIG, ...config } };
}

function ok(r: MinifyResult) {
  if (!r.ok) throw new Error('expected success, got ' + JSON.stringify(r.errors));
  return r;
}

describe('minifyJs', () => {
  it('minifies and keeps license comments', async () => {
    const r = ok(await minifyJs(inp('/w/a.js', '/*! (c) me */\nfunction add(first, second) {\n  return first + second;\n}\nwindow.add = add;\n')));
    expect(r.outputs).toHaveLength(1);
    expect(r.outputs[0].path).toBe('/w/a.min.js');
    expect(r.outputs[0].content).toContain('/*! (c) me */');
    expect(r.outputs[0].content.length).toBeLessThan(60);
  });

  it('drops license comments when asked', async () => {
    const r = ok(await minifyJs(inp('/w/a.js', '/*! (c) me */\nwindow.x = 1;', { preserveLicenseComments: false })));
    expect(r.outputs[0].content).not.toContain('(c) me');
  });

  it('behaves the same after minifying', async () => {
    const src = `
      function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
      var list = []; for (var i = 0; i < 10; i++) { list.push(fib(i)); }
      result = list.join(',') + '|' + typeof fib;
    `;
    const r = ok(await minifyJs(inp('/w/a.js', src)));
    const run = (code: string) => {
      const ctx: { result?: string } = {};
      vm.runInNewContext(code, ctx);
      return ctx.result;
    };
    expect(run(r.outputs[0].content)).toBe(run(src));
  });

  it('keeps top-level names of a classic script (other scripts may use them)', async () => {
    const r = ok(await minifyJs(inp('/w/a.js', 'function helperForOtherScripts(value) { return value * 2; }')));
    expect(r.outputs[0].content).toContain('helperForOtherScripts');
  });

  it('reports a syntax error with a 1-based position', async () => {
    const r = await minifyJs(inp('/w/a.js', 'var ok = 1;\nvar broken = ;\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ line: 2, column: 14 });
  });

  it('writes a source map next to the output', async () => {
    const r = ok(await minifyJs(inp('/w/js/a.js', 'function f(x) { return x + 1; }\nf(1);', { sourceMap: true })));
    expect(r.outputs.map((o) => o.path)).toEqual(['/w/js/a.min.js', '/w/js/a.min.js.map']);
    expect(r.outputs[0].content).toMatch(/\/\/# sourceMappingURL=a\.min\.js\.map$/);
    const map = JSON.parse(r.outputs[1].content);
    expect(map.sources).toEqual(['a.js']);
    expect(map.file).toBe('a.min.js');
  });

  it('records the source relative to a map in another folder', async () => {
    const r = ok(await minifyJs(inp('/w/src/a.js', 'f(1);', { sourceMap: true }, '/w/dist/a.min.js')));
    expect(JSON.parse(r.outputs[1].content).sources).toEqual(['../src/a.js']);
  });

  it('replaces an existing sourceMappingURL instead of keeping two', async () => {
    const r = ok(await minifyJs(inp('/w/a.js', 'f(1);\n//# sourceMappingURL=old.js.map\n', { sourceMap: true })));
    expect(r.outputs[0].content.match(/sourceMappingURL/g)).toHaveLength(1);
  });

  it('lets user terser options through', async () => {
    const r = ok(await minifyJs(inp('/w/a.js', 'function f(longName) { return longName; } window.f = f;', { terser: { mangle: false } })));
    expect(r.outputs[0].content).toContain('longName');
  });
});

describe('detectModule', () => {
  it('uses the extension when it says', () => {
    expect(detectModule('/w/a.mjs', '')).toBe(true);
    expect(detectModule('/w/a.cjs', 'import x from "y"')).toBe(false);
  });

  it('spots top-level import/export in .js', () => {
    expect(detectModule('/w/a.js', "import { a } from './a.js';\na();")).toBe(true);
    expect(detectModule('/w/a.js', 'export default 1;')).toBe(true);
    expect(detectModule('/w/a.js', 'var exported = 1; // export later')).toBe(false);
    expect(detectModule('/w/a.js', 'const m = await import("./x.js");')).toBe(false);
  });

  it('parses an ES module .js without failing', async () => {
    const r = await minifyJs(inp('/w/a.js', "import { a } from './a.js';\nexport const b = a + 1;\n"));
    expect(r.ok).toBe(true);
  });
});

describe('minifyCss', () => {
  it('minifies and keeps /*! */ comments', async () => {
    const r = ok(await minifyCss(inp('/w/a.css', '/*! keep */\n.a {\n  color : red ;\n}\n/* drop */\n.b { margin: 0px }\n')));
    expect(r.outputs[0].content).toBe('/*! keep */.a{color:red}.b{margin:0}');
  });

  it('drops /*! */ comments when asked, whatever the level', async () => {
    for (const level of [1, 2, { 1: { all: true } }]) {
      const r = ok(await minifyCss(inp('/w/a.css', '/*! keep */ .a { color: red }', { preserveLicenseComments: false, cleancss: { level } })));
      expect(r.outputs[0].content).toBe('.a{color:red}');
    }
  });

  it('refuses to write CSS that clean-css had to cut', async () => {
    const r = await minifyCss(inp('/w/a.css', '.a { color: red }\n}}\n.b { color: blue }'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].line).toBe(2);
  });

  it('keeps @import as written', async () => {
    const r = ok(await minifyCss(inp('/w/a.css', '@import url("base.css");\n.a { color: red }')));
    expect(r.outputs[0].content).toContain('@import url(base.css)');
  });

  it('writes a source map', async () => {
    const r = ok(await minifyCss(inp('/w/css/a.css', '.a {\n  color: red;\n}\n', { sourceMap: true })));
    expect(r.outputs[0].content).toBe('.a{color:red}\n/*# sourceMappingURL=a.min.css.map */');
    expect(JSON.parse(r.outputs[1].content)).toMatchObject({ sources: ['a.css'], file: 'a.min.css' });
  });

  it('rebases url() only when the output moves folder', () => {
    expect(buildCleanCssOptions(inp('/w/css/a.css', ''), false)).toMatchObject({ rebase: false, rebaseTo: '/w/css' });
    const moved = buildCleanCssOptions(inp('/w/css/a.css', '', {}, '/w/dist/a.min.css'), false);
    expect(moved).toMatchObject({ rebase: true, rebaseTo: '/w/dist' });
  });
});

describe('minifyHtml', () => {
  it('collapses whitespace without gluing words together and minifies inline CSS/JS', async () => {
    const r = ok(await minifyHtml(inp('/w/a.html', '<p>  Hello\n  <b>World</b>  </p>\n<!-- note -->\n<style> a { color : red } </style>\n<script> var  x = 1 ; </script>')));
    const out = r.outputs[0].content;
    expect(out).toContain('Hello <b>World</b>');
    expect(out).not.toContain('note');
    expect(out).toContain('a{color:red}');
    expect(out).toContain('var x=1');
  });

  it('leaves template tags alone', async () => {
    const r = ok(await minifyHtml(inp('/w/a.html', '<p>  <?php echo  $a ?>  {{  name  }} </p>')));
    expect(r.outputs[0].content).toContain('<?php echo  $a ?>');
    expect(r.outputs[0].content).toContain('{{  name  }}');
  });

  it('keeps <!--! --> comments by default', async () => {
    const r = ok(await minifyHtml(inp('/w/a.html', '<!--! license --><p>x</p>')));
    expect(r.outputs[0].content).toContain('<!--! license -->');
  });

  it('accepts ignoreCustomFragments as strings from settings.json', async () => {
    const r = ok(await minifyHtml(inp('/w/a.html', '<p>  [[  keep  ]]  </p>', { html: { ignoreCustomFragments: ['\\[\\[[\\s\\S]*?\\]\\]'] } })));
    expect(r.outputs[0].content).toContain('[[  keep  ]]');
  });

  it('reports a parse error with its line', async () => {
    const r = await minifyHtml(inp('/w/a.html', '<div>\n<p>ok</p>\n<<<script>\n</div>'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].line).toBe(3);
  });
});

describe('minifyScss', () => {
  let dir: string;
  beforeAll(() => {
    dir = toPosix(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-scss-')));
    fs.mkdirSync(`${dir}/partials`);
    fs.writeFileSync(`${dir}/partials/_vars.scss`, '$brand: #ff0000;\n');
    fs.writeFileSync(`${dir}/_broken.scss`, '.x { color: $missing; }\n');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const main = '@use "partials/vars";\n/*! keep */\n.a {\n  color: vars.$brand;\n  .b { margin: 0 }\n}\n';

  it('compiles to compressed CSS and reports what it loaded', async () => {
    const r = ok(await minifyScss(inp(`${dir}/main.scss`, main), { loadPaths: [] }));
    expect(r.outputs).toEqual([{ path: `${dir}/main.min.css`, content: '/*! keep */.a{color:red}.a .b{margin:0}' }]);
    expect(r.dependencies?.map((d) => d.toLowerCase())).toEqual([`${dir}/partials/_vars.scss`.toLowerCase()]);
  });

  it('compiles the indented syntax', async () => {
    const r = ok(await minifyScss(inp(`${dir}/a.sass`, '.a\n  color: blue\n'), { loadPaths: [] }));
    expect(r.outputs[0].content).toBe('.a{color:blue}');
  });

  it('also writes the expanded CSS when emitCss is on', async () => {
    const r = ok(await minifyScss(inp(`${dir}/main.scss`, main, { scssEmitCss: true }), { loadPaths: [] }));
    expect(r.outputs.map((o) => o.path)).toEqual([`${dir}/main.min.css`, `${dir}/main.css`]);
    expect(r.outputs[1].content).toContain('.a .b {\n  margin: 0;\n}');
  });

  it('writes a source map with relative sources', async () => {
    const r = ok(await minifyScss(inp(`${dir}/main.scss`, main, { sourceMap: true }), { loadPaths: [] }));
    expect(r.outputs[0].content).toMatch(/\/\*# sourceMappingURL=main\.min\.css\.map \*\/$/);
    const map = JSON.parse(r.outputs[1].content);
    expect(map.sources.sort()).toEqual(['main.scss', 'partials/_vars.scss']);
    expect(map.sourceRoot).toBeUndefined();
  });

  it('resolves from loadPaths', async () => {
    const r = await minifyScss(inp(`${dir}/sub/x.scss`, '@use "vars";\n.a { color: vars.$brand }'), { loadPaths: [`${dir}/partials`] });
    expect(r.ok).toBe(true);
  });

  it('reports an error in the entry with a 1-based position', async () => {
    const r = await minifyScss(inp(`${dir}/main.scss`, '.a {\n  color: $nope;\n}'), { loadPaths: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ message: 'Undefined variable.', line: 2, column: 10, file: undefined });
  });

  it('attributes an error inside a partial to the partial', async () => {
    const r = await minifyScss(inp(`${dir}/main.scss`, '@use "broken";'), { loadPaths: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors[0].file?.toLowerCase()).toBe(`${dir}/_broken.scss`.toLowerCase());
      expect(r.errors[0].line).toBe(1);
    }
  });

  it('collects Sass warnings', async () => {
    const r = ok(await minifyScss(inp(`${dir}/main.scss`, '@warn "careful";\n.a{color:red}'), { loadPaths: [] }));
    expect(r.warnings[0].message).toContain('careful');
  });
});

describe('runMinifier', () => {
  it('dispatches by extension', async () => {
    const r = ok(await runMinifier(inp('/w/a.css', '.a { color: red }'), { loadPaths: [] }));
    expect(r.outputs[0].content).toBe('.a{color:red}');
    expect((await runMinifier(inp('/w/a.ts', 'x'), { loadPaths: [] })).ok).toBe(false);
  });
});
