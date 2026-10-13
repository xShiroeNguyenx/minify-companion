import { describe, expect, it } from 'vitest';
import { expandedCssPath, isInside, relativeFromMap, resolveOutputPath, samePath, toPosix } from './paths';

const P = '${dir}/${name}.min.${ext}';

describe('resolveOutputPath', () => {
  it('puts the min file next to the source by default', () => {
    expect(resolveOutputPath('/srv/site/css/style.css', P, '/srv/site')).toEqual({ ok: true, path: '/srv/site/css/style.min.css' });
    expect(resolveOutputPath('/srv/site/app.mjs', P)).toEqual({ ok: true, path: '/srv/site/app.min.mjs' });
  });

  it('works with Windows drive paths', () => {
    expect(resolveOutputPath('D:/site/js/app.js', P, 'D:/site')).toEqual({ ok: true, path: 'D:/site/js/app.min.js' });
  });

  it('compiles Sass to a .css target', () => {
    expect(resolveOutputPath('/w/scss/main.scss', P, '/w')).toEqual({ ok: true, path: '/w/scss/main.min.css' });
    expect(resolveOutputPath('/w/main.sass', P, '/w')).toEqual({ ok: true, path: '/w/main.min.css' });
  });

  it('keeps inner dots in ${name}', () => {
    expect(resolveOutputPath('/w/a.module.css', P, '/w')).toEqual({ ok: true, path: '/w/a.module.min.css' });
  });

  it('expands ${workspaceFolder} and ${relativeDir}', () => {
    const r = resolveOutputPath('/w/src/css/a.css', '${workspaceFolder}/public/${relativeDir}/${name}.min.${ext}', '/w');
    expect(r).toEqual({ ok: true, path: '/w/public/src/css/a.min.css' });
    expect(resolveOutputPath('/w/a.css', '${workspaceFolder}/out/${relativeDir}/${name}.css', '/w')).toEqual({ ok: true, path: '/w/out/a.css' });
  });

  it('treats a pattern without a variable as relative to the source folder', () => {
    expect(resolveOutputPath('/w/css/a.css', 'min/${name}.${ext}', '/w')).toEqual({ ok: true, path: '/w/css/min/a.css' });
  });

  it('refuses a target equal to the source', () => {
    const r = resolveOutputPath('/w/a.css', '${dir}/${name}.${ext}', '/w');
    expect(r.ok).toBe(false);
  });

  it('refuses the source on Windows even with different case', () => {
    expect(resolveOutputPath('D:/w/A.css', 'd:/w/a.css', 'D:/w').ok).toBe(false);
  });

  it('refuses a target outside the workspace folder', () => {
    const r = resolveOutputPath('/w/a.css', '${dir}/../../etc/${name}.css', '/w');
    expect(r).toMatchObject({ ok: false });
  });

  it('refuses a target outside the folder of a loose file', () => {
    expect(resolveOutputPath('/tmp/x/a.css', '${dir}/../${name}.min.css').ok).toBe(false);
  });

  it('refuses workspace variables for a loose file', () => {
    expect(resolveOutputPath('/tmp/a.css', '${workspaceFolder}/a.min.css').ok).toBe(false);
  });

  it('refuses unknown variables and empty patterns', () => {
    expect(resolveOutputPath('/w/a.css', '${dir}/${base}.min.css', '/w')).toMatchObject({ ok: false });
    expect(resolveOutputPath('/w/a.css', '  ', '/w').ok).toBe(false);
  });
});

describe('path helpers', () => {
  it('toPosix converts backslashes', () => {
    expect(toPosix('D:\\a\\b.css')).toBe('D:/a/b.css');
  });

  it('samePath folds case only for Windows paths', () => {
    expect(samePath('D:/A/b.css', 'd:/a/B.css')).toBe(true);
    expect(samePath('/A/b.css', '/a/b.css')).toBe(false);
  });

  it('isInside does not match a sibling with a common prefix', () => {
    expect(isInside('/w/site/a.css', '/w/site')).toBe(true);
    expect(isInside('/w/site-2/a.css', '/w/site')).toBe(false);
    expect(isInside('D:/W/a.css', 'd:/w/')).toBe(true);
  });

  it('expandedCssPath sits next to the min file', () => {
    expect(expandedCssPath('/w/out/main.min.css', '/w/scss/main.scss')).toBe('/w/out/main.css');
  });

  it('relativeFromMap is relative to the map folder', () => {
    expect(relativeFromMap('/w/css/a.min.css.map', '/w/css/a.css')).toBe('a.css');
    expect(relativeFromMap('/w/dist/a.min.css.map', '/w/scss/_v.scss')).toBe('../scss/_v.scss');
  });
});
