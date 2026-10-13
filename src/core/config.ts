import type { Lang, MinifyConfig, OnSaveMode } from './types';

export const DEFAULT_CONFIG: MinifyConfig = {
  onSave: 'ifMinExists',
  languages: ['css', 'javascript', 'html', 'scss'],
  exclude: ['**/node_modules/**', '**/vendor/**', '**/dist/**', '**/*.min.*'],
  outputPattern: '${dir}/${name}.min.${ext}',
  sourceMap: false,
  preserveLicenseComments: true,
  terser: {},
  cleancss: { level: 1 },
  html: {},
  scssEmitCss: false,
  scssLoadPaths: [],
  maxFileSizeKB: 5120,
};

const ON_SAVE: OnSaveMode[] = ['ifMinExists', 'always', 'off'];
const LANGS: Lang[] = ['css', 'javascript', 'html', 'scss'];

/** Setting keys under `minifyCompanion.`, mapped to the field they fill. */
const KEYS: Record<keyof MinifyConfig, string> = {
  onSave: 'onSave',
  languages: 'languages',
  exclude: 'exclude',
  outputPattern: 'outputPattern',
  sourceMap: 'sourceMap',
  preserveLicenseComments: 'preserveLicenseComments',
  terser: 'js.terser',
  cleancss: 'css.cleancss',
  html: 'html.options',
  scssEmitCss: 'scss.emitCss',
  scssLoadPaths: 'scss.loadPaths',
  maxFileSizeKB: 'maxFileSizeKB',
};

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export interface NormalizedConfig {
  config: MinifyConfig;
  /** One line per setting that had the wrong type and fell back to its default. */
  warnings: string[];
}

/**
 * Builds a MinifyConfig from raw setting values. VS Code does not enforce the schema on
 * settings.json, so a hand-edited `"sourceMap": "yes"` arrives as a string: every value is checked
 * and a wrong one falls back to the default with a warning, instead of crashing a minify later.
 */
export function normalizeConfig(get: (key: string) => unknown): NormalizedConfig {
  const warnings: string[] = [];
  const config: MinifyConfig = { ...DEFAULT_CONFIG };

  const take = <K extends keyof MinifyConfig>(field: K, valid: (v: unknown) => boolean) => {
    const key = KEYS[field];
    const value = get(key);
    if (value === undefined || value === null) return;
    if (valid(value)) {
      config[field] = value as MinifyConfig[K];
    } else {
      warnings.push(`minifyCompanion.${key} has an invalid value (${JSON.stringify(value)}); using the default.`);
    }
  };

  take('onSave', (v) => ON_SAVE.includes(v as OnSaveMode));
  take('languages', (v) => isStringArray(v) && v.every((l) => LANGS.includes(l as Lang)));
  take('exclude', isStringArray);
  take('outputPattern', (v) => typeof v === 'string' && v.trim() !== '');
  take('sourceMap', (v) => typeof v === 'boolean');
  take('preserveLicenseComments', (v) => typeof v === 'boolean');
  take('terser', isPlainObject);
  take('cleancss', isPlainObject);
  take('html', isPlainObject);
  take('scssEmitCss', (v) => typeof v === 'boolean');
  take('scssLoadPaths', isStringArray);
  take('maxFileSizeKB', (v) => typeof v === 'number' && Number.isFinite(v) && v > 0);

  return { config, warnings };
}
