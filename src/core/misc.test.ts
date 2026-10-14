import { describe, expect, it } from 'vitest';
import { locateHtmlError, parseCleanCssMessage, positionOf, stripSourceMapComment, withSourceMapComment } from './issues';
import { isMinFile, isSassPartial, langFromPath, outputExtension } from './lang';
import { KeyedQueue, runPool } from './queue';
import { ScssGraph } from './scssGraph';
import { byteLength, formatBytes, formatSaving, gzipSize, savingPercent, stripBom } from './stats';

describe('lang', () => {
  it('maps extensions case-insensitively', () => {
    expect(langFromPath('/w/A.CSS')).toBe('css');
    expect(langFromPath('/w/a.cjs')).toBe('javascript');
    expect(langFromPath('/w/a.htm')).toBe('html');
    expect(langFromPath('/w/a.sass')).toBe('scss');
    expect(langFromPath('/w/a.ts')).toBeUndefined();
  });

  it('recognises min files and partials', () => {
    expect(isMinFile('/w/a.min.js')).toBe(true);
    expect(isMinFile('/w/admin.js')).toBe(false);
    expect(isMinFile('/w/a.min/b.js')).toBe(false);
    expect(isSassPartial('/w/_v.scss')).toBe(true);
    expect(isSassPartial('/w/_v.css')).toBe(false);
  });

  it('outputs .css for Sass', () => {
    expect(outputExtension('/w/a.scss')).toBe('css');
    expect(outputExtension('/w/a.mjs')).toBe('mjs');
  });
});

describe('stats', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(12595)).toBe('12.3 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });

  it('computes savings', () => {
    expect(savingPercent(1000, 330)).toBe(67);
    expect(savingPercent(0, 0)).toBe(0);
    expect(savingPercent(100, 120)).toBe(-20);
    expect(formatSaving(1000, 330)).toBe('−67%');
    expect(formatSaving(21, 55)).toBe('+162%');
  });

  it('measures the gzipped size, which is smaller for repetitive text', () => {
    const text = '.a{color:red}'.repeat(500);
    const size = gzipSize(text);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThan(byteLength(text) / 10);
    expect(gzipSize('')).toBeGreaterThan(0); // the gzip header alone
  });

  it('counts UTF-8 bytes and strips a BOM', () => {
    expect(byteLength('Việt')).toBe(6);
    expect(stripBom('\uFEFFa{}')).toBe('a{}');
    expect(stripBom('a{}')).toBe('a{}');
  });
});

describe('issues', () => {
  it('parses clean-css positions and flags parse problems as fatal', () => {
    expect(parseCleanCssMessage("Unexpected '}' at 3:12.")).toEqual({ message: "Unexpected '}' at 3:12.", line: 3, column: 13, fatal: true });
    expect(parseCleanCssMessage("Unexpected '}' at ../../../w/a.css:3:0.")).toMatchObject({ message: "Unexpected '}' at 3:0.", line: 3, column: 1 });
    expect(parseCleanCssMessage("Invalid selector '}}\n.b' at D:/w/a.css:3:0. Ignoring.")).toMatchObject({ line: 3, fatal: true });
    expect(parseCleanCssMessage('Broken URL in `url(x)`.').fatal).toBe(false);
  });

  it('finds the position of an HTML parse error', () => {
    const src = '<div>\n  <p>ok</p>\n  <<<script>\n</div>';
    expect(locateHtmlError('Parse Error: <<<script>\n</div>', src)).toMatchObject({ line: 3, column: 3 });
    expect(locateHtmlError('Something else', src)).toEqual({ message: 'Something else' });
  });

  it('positionOf is 1-based', () => {
    expect(positionOf('ab\ncd', 0)).toEqual({ line: 1, column: 1 });
    expect(positionOf('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });

  it('adds and strips source map comments', () => {
    expect(withSourceMapComment('a{}', 'a.min.css.map', 'css')).toBe('a{}\n/*# sourceMappingURL=a.min.css.map */');
    expect(withSourceMapComment('x()', 'a.min.js.map', 'js')).toBe('x()\n//# sourceMappingURL=a.min.js.map');
    expect(stripSourceMapComment('x()\n//# sourceMappingURL=old.map\n')).toBe('x()');
    expect(stripSourceMapComment('a{}\n/*# sourceMappingURL=old.map */')).toBe('a{}');
  });
});

describe('ScssGraph', () => {
  it('finds the entries that load a partial, case-insensitively on Windows', () => {
    const g = new ScssGraph();
    g.setDependencies('D:/w/main.scss', ['D:/w/_vars.scss', 'D:/w/main.scss']);
    g.setDependencies('D:/w/admin.scss', ['D:/w/_vars.scss', 'D:/w/_admin.scss']);
    expect(g.dependentsOf('d:/w/_VARS.scss').sort()).toEqual(['D:/w/admin.scss', 'D:/w/main.scss']);
    expect(g.dependentsOf('D:/w/_admin.scss')).toEqual(['D:/w/admin.scss']);
    expect(g.knows('D:/w/_other.scss')).toBe(false);
    g.setDependencies('D:/w/admin.scss', []);
    expect(g.dependentsOf('D:/w/_admin.scss')).toEqual([]);
  });
});

describe('KeyedQueue', () => {
  it('runs one task per key and keeps only the latest waiting one', async () => {
    const q = new KeyedQueue();
    const ran: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p1 = q.schedule('a', async () => {
      await gate;
      ran.push(1);
    });
    const p2 = q.schedule('a', async () => void ran.push(2));
    const p3 = q.schedule('a', async () => void ran.push(3));
    expect(q.isBusy('a')).toBe(true);
    release();
    await Promise.all([p1, p2, p3]);
    expect(ran).toEqual([1, 3]);
    expect(q.isBusy('a')).toBe(false);
  });

  it('runs different keys in parallel and survives a failing task', async () => {
    const errors: string[] = [];
    const q = new KeyedQueue((key) => errors.push(key));
    const ran: string[] = [];
    await Promise.all([
      q.schedule('a', async () => {
        throw new Error('boom');
      }),
      q.schedule('b', async () => void ran.push('b')),
    ]);
    expect(errors).toEqual(['a']);
    expect(ran).toEqual(['b']);
  });
});

describe('runPool', () => {
  it('limits concurrency and stops when cancelled', async () => {
    let active = 0;
    let peak = 0;
    const done: number[] = [];
    await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      done.push(n);
      active--;
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);

    const seen: number[] = [];
    await runPool([1, 2, 3, 4], 1, async (n) => void seen.push(n), () => seen.length >= 2);
    expect(seen).toEqual([1, 2]);
  });
});
