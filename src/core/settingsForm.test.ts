import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { FIELDS, formatFieldValue, isValidValue, parseFieldInput, previewOutputPattern, splitLines } from './settingsForm';

describe('FIELDS', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  const props = pkg.contributes.configuration.properties as Record<string, unknown>;

  it('covers every contributed setting, and nothing else', () => {
    expect(FIELDS.map((f) => `minifyCompanion.${f.key}`).sort()).toEqual(Object.keys(props).sort());
  });

  it('marks exactly the settings restricted in untrusted workspaces', () => {
    const restricted: string[] = pkg.capabilities.untrustedWorkspaces.restrictedConfigurations;
    expect(FIELDS.filter((f) => f.restricted).map((f) => `minifyCompanion.${f.key}`).sort()).toEqual([...restricted].sort());
  });
});

describe('parseFieldInput', () => {
  it('rejects a setting the screen does not know', () => {
    expect(parseFieldInput('somethingElse', true)).toEqual({ ok: false, error: { code: 'unknownSetting' } });
  });

  it('accepts booleans and refuses anything else for a checkbox', () => {
    expect(parseFieldInput('sourceMap', true)).toEqual({ ok: true, value: true });
    expect(parseFieldInput('statusBar', false)).toEqual({ ok: true, value: false });
    expect(parseFieldInput('sourceMap', 'yes').ok).toBe(false);
    expect(parseFieldInput('statusBar', 1).ok).toBe(false);
  });

  it('accepts only the listed onSave modes and languages', () => {
    expect(parseFieldInput('onSave', 'always')).toEqual({ ok: true, value: 'always' });
    expect(parseFieldInput('onSave', 'sometimes').ok).toBe(false);
    expect(parseFieldInput('languages', ['css', 'scss'])).toEqual({ ok: true, value: ['css', 'scss'] });
    expect(parseFieldInput('languages', ['css', 'php']).ok).toBe(false);
  });

  it('turns a text area into one trimmed entry per non-empty line', () => {
    expect(parseFieldInput('exclude', '  **/build/** \r\n\n**/*.min.*\n')).toEqual({ ok: true, value: ['**/build/**', '**/*.min.*'] });
    expect(parseFieldInput('scss.loadPaths', '')).toEqual({ ok: true, value: [] });
    expect(splitLines(' a \n\n b ')).toEqual(['a', 'b']);
  });

  it('reads a positive number', () => {
    expect(parseFieldInput('maxFileSizeKB', ' 2048 ')).toEqual({ ok: true, value: 2048 });
    for (const bad of ['', 'abc', '0', '-5', 'Infinity']) {
      expect(parseFieldInput('maxFileSizeKB', bad)).toEqual({ ok: false, error: { code: 'notNumber' } });
    }
  });

  it('parses minifier options as a JSON object, an empty box meaning {}', () => {
    expect(parseFieldInput('js.terser', '{ "mangle": false }')).toEqual({ ok: true, value: { mangle: false } });
    expect(parseFieldInput('html.options', '  ')).toEqual({ ok: true, value: {} });
    const broken = parseFieldInput('css.cleancss', '{ level: 2 }');
    expect(broken.ok).toBe(false);
    expect(!broken.ok && broken.error.code).toBe('notJson');
    expect(parseFieldInput('css.cleancss', '[1]')).toEqual({ ok: false, error: { code: 'notObject' } });
    expect(parseFieldInput('css.cleancss', 'null')).toEqual({ ok: false, error: { code: 'notObject' } });
  });

  it('refuses an output pattern that is wrong for every file', () => {
    expect(parseFieldInput('outputPattern', ' ${dir}/${name}.min.${ext} ')).toEqual({ ok: true, value: '${dir}/${name}.min.${ext}' });
    for (const bad of ['${dir}/${nam}.min.${ext}', '${dir}/${name}.${ext}', '${workspaceFolder}/../out/${name}.${ext}', '']) {
      const result = parseFieldInput('outputPattern', bad);
      expect(result.ok, bad).toBe(false);
    }
  });

  it('leaves a literal absolute output folder to the engine when no workspace folder is known', () => {
    expect(parseFieldInput('outputPattern', 'D:/site/public/${name}.min.${ext}').ok).toBe(true);
    expect(parseFieldInput('outputPattern', '/srv/site/public/${name}.min.${ext}').ok).toBe(true);
  });

  it('judges a literal absolute output folder against the real workspace folder', () => {
    const context = { workspaceFolder: 'D:/site' };
    expect(parseFieldInput('outputPattern', 'D:/site/public/${name}.min.${ext}', context).ok).toBe(true);
    expect(parseFieldInput('outputPattern', 'd:/SITE/public/${name}.min.${ext}', context).ok).toBe(true);
    const outside = parseFieldInput('outputPattern', 'D:/elsewhere/${name}.min.${ext}', context);
    expect(!outside.ok && outside.error.code).toBe('badPattern');
  });

  it('does not refuse a pattern that only fails for the open file', () => {
    // The open file is outside any folder, so ${workspaceFolder} cannot apply to it; the pattern
    // still works for every file in the workspace.
    const context = { workspaceFolder: '/srv/site', current: '/tmp/scratch.css' };
    expect(parseFieldInput('outputPattern', '${workspaceFolder}/public/${name}.min.${ext}', context).ok).toBe(true);
  });
});

describe('previewOutputPattern', () => {
  it('shows where the sample sources go, Sass compiling to CSS', () => {
    expect(previewOutputPattern('${dir}/${name}.min.${ext}')).toEqual({
      rows: [
        { source: 'css/style.css', output: 'css/style.min.css' },
        { source: 'js/app.js', output: 'js/app.min.js' },
        { source: 'scss/theme.scss', output: 'scss/theme.min.css' },
      ],
    });
  });

  it('mirrors the source tree under another folder', () => {
    expect(previewOutputPattern('${workspaceFolder}/public/${relativeDir}/${name}.min.${ext}').rows[0].output).toBe('public/css/style.min.css');
  });

  it('gives the reason without the made-up sample folder', () => {
    const outside = previewOutputPattern('${workspaceFolder}/../out/${name}.${ext}');
    expect(outside.rows).toEqual([]);
    expect(outside.error).toContain('outside the workspace folder');
    const self = previewOutputPattern('${dir}/${name}.${ext}');
    expect(self.error).toContain('source file itself');
    expect(JSON.stringify([outside, self])).not.toContain('/workspace/');
  });

  it('puts the open file first, relative to its workspace folder, and skips the sample it duplicates', () => {
    const result = previewOutputPattern('${workspaceFolder}/public/${relativeDir}/${name}.min.${ext}', {
      workspaceFolder: 'D:/site',
      current: 'D:/site/css/style.css',
    });
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([
      { source: 'css/style.css', output: 'public/css/style.min.css', current: true },
      { source: 'js/app.js', output: 'public/js/app.min.js' },
      { source: 'scss/theme.scss', output: 'public/scss/theme.min.css' },
    ]);
  });

  it('leaves out an open file that is not a source', () => {
    for (const current of ['/srv/site/css/style.min.css', '/srv/site/scss/_vars.scss', '/srv/site/readme.md']) {
      const rows = previewOutputPattern('${dir}/${name}.min.${ext}', { workspaceFolder: '/srv/site', current }).rows;
      expect(rows.some((r) => r.current), current).toBe(false);
    }
  });

  it('reports an open file the pattern cannot place on its own row', () => {
    const result = previewOutputPattern('${workspaceFolder}/public/${name}.min.${ext}', { workspaceFolder: '/srv/site', current: '/tmp/scratch.css' });
    expect(result.error).toBeUndefined();
    expect(result.rows[0]).toMatchObject({ source: '/tmp/scratch.css', current: true });
    expect(result.rows[0].error).toContain('not in a workspace folder');
    expect(result.rows).toHaveLength(4);
  });

  it('keeps the open file when the pattern is wrong for every file', () => {
    const result = previewOutputPattern('${dir}/${nope}.${ext}', { workspaceFolder: '/srv/site', current: '/srv/site/a.js' });
    expect(result.error).toContain('${nope}');
    expect(result.rows).toEqual([{ source: 'a.js', error: expect.stringContaining('${nope}'), current: true }]);
  });
});

describe('isValidValue', () => {
  it('uses the same rules as the engine', () => {
    expect(isValidValue('sourceMap', 'yes')).toBe(false);
    expect(isValidValue('statusBar', true)).toBe(true);
    expect(isValidValue('statusBar', 'on')).toBe(false);
    expect(isValidValue('js.terser', [])).toBe(false);
    expect(isValidValue('onSave', 'always')).toBe(true);
  });
});

describe('formatFieldValue', () => {
  it('is the reverse of parseFieldInput for each kind of field', () => {
    for (const [key, raw] of [
      ['exclude', '**/a/**\n**/b/**'],
      ['js.terser', JSON.stringify({ mangle: false }, null, 2)],
      ['maxFileSizeKB', '100'],
      ['onSave', 'off'],
      ['sourceMap', true],
    ] as const) {
      const parsed = parseFieldInput(key, raw);
      expect(parsed.ok && formatFieldValue(key, parsed.value)).toEqual(raw);
    }
  });
});
