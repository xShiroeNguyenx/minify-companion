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
export const KEYS: Record<keyof MinifyConfig, string> = {
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
const isBoolean = (v: unknown) => typeof v === 'boolean';

/** What a valid value looks like for each MinifyConfig field. Shared with the settings screen. */
export const VALIDATORS: Record<keyof MinifyConfig, (v: unknown) => boolean> = {
  onSave: (v) => ON_SAVE.includes(v as OnSaveMode),
  languages: (v) => isStringArray(v) && v.every((l) => LANGS.includes(l as Lang)),
  exclude: isStringArray,
  outputPattern: (v) => typeof v === 'string' && v.trim() !== '',
  sourceMap: isBoolean,
  preserveLicenseComments: isBoolean,
  terser: isPlainObject,
  cleancss: isPlainObject,
  html: isPlainObject,
  scssEmitCss: isBoolean,
  scssLoadPaths: isStringArray,
  maxFileSizeKB: (v) => typeof v === 'number' && Number.isFinite(v) && v > 0,
};

/** Setting key under `minifyCompanion.` → the MinifyConfig field it fills. */
export const FIELD_BY_KEY = Object.fromEntries(Object.entries(KEYS).map(([field, key]) => [key, field])) as Record<string, keyof MinifyConfig>;

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

  for (const field of Object.keys(KEYS) as Array<keyof MinifyConfig>) {
    const key = KEYS[field];
    const value = get(key);
    if (value === undefined || value === null) continue;
    if (VALIDATORS[field](value)) {
      // VS Code hands out objects and arrays from settings as read-only proxies, which cannot be
      // posted to a worker thread ("could not be cloned"). Settings are JSON, so a JSON round
      // trip gives plain data.
      (config as unknown as Record<string, unknown>)[field] = typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
    } else {
      warnings.push(`minifyCompanion.${key} has an invalid value (${JSON.stringify(value)}); using the default.`);
    }
  }

  return { config, warnings };
}
