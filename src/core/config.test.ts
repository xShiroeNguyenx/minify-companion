import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, normalizeConfig } from './config';

describe('normalizeConfig', () => {
  it('returns the defaults when nothing is set', () => {
    expect(normalizeConfig(() => undefined)).toEqual({ config: DEFAULT_CONFIG, warnings: [] });
  });

  it('reads nested keys', () => {
    const values: Record<string, unknown> = {
      'js.terser': { mangle: false },
      'scss.emitCss': true,
      'scss.loadPaths': ['styles'],
      onSave: 'always',
    };
    const { config, warnings } = normalizeConfig((k) => values[k]);
    expect(warnings).toEqual([]);
    expect(config.terser).toEqual({ mangle: false });
    expect(config.scssEmitCss).toBe(true);
    expect(config.scssLoadPaths).toEqual(['styles']);
    expect(config.onSave).toBe('always');
  });

  it('falls back to the default, with a warning, for a wrongly typed value', () => {
    const values: Record<string, unknown> = { sourceMap: 'yes', onSave: 'sometimes', maxFileSizeKB: -1, languages: ['css', 'php'] };
    const { config, warnings } = normalizeConfig((k) => values[k]);
    expect(config.sourceMap).toBe(false);
    expect(config.onSave).toBe('ifMinExists');
    expect(config.maxFileSizeKB).toBe(5120);
    expect(config.languages).toEqual(DEFAULT_CONFIG.languages);
    expect(warnings).toHaveLength(4);
    expect(warnings[0]).toContain('minifyCompanion.onSave');
  });

  it('returns plain data that can be posted to a worker, even when settings are proxies', () => {
    // What vscode.workspace.getConfiguration().get() returns for objects and arrays.
    const proxy = <T extends object>(o: T) => new Proxy(Object.freeze(o), {});
    const values: Record<string, unknown> = {
      'js.terser': proxy({ compress: proxy({ passes: 2 }) }),
      exclude: proxy(['**/x/**']),
    };
    expect(() => structuredClone(values['js.terser'])).toThrow();
    const { config } = normalizeConfig((k) => values[k]);
    expect(() => structuredClone(config)).not.toThrow();
    expect(config.terser).toEqual({ compress: { passes: 2 } });
    expect(config.exclude).toEqual(['**/x/**']);
  });

  it('does not share array instances with the defaults', () => {
    const { config } = normalizeConfig(() => undefined);
    expect(config).not.toBe(DEFAULT_CONFIG);
  });
});
